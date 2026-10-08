const express = require('express');
const { pool } = require('../DB/db');
const { requireLogin, requirePermiso, tienePermiso } = require('../middleware/auth');
const { limpiar } = require('../lib/validacion');

const router = express.Router();

// Letras, números, espacios y . @ ' -
const CRITERIO_VALIDO = /^[\p{L}\p{N} .@'-]+$/u;

// Búsqueda de beneficiarios por nombre o número de identificación (HU14).
// Un beneficiario es la persona registrada en los tickets; se agrupan por documento.
router.get('/api/beneficiarios', requirePermiso('beneficiarios.consultar'), async (req, res) => {
    const q = limpiar(req.query.q);
    if (!q || q.length < 3) {
        return res.status(400).json({ error: 'Ingresa al menos 3 caracteres del nombre o del número de identificación.' });
    }
    if (q.length > 100 || !CRITERIO_VALIDO.test(q)) {
        return res.status(400).json({ error: 'El criterio de búsqueda no es válido. Usa solo letras, números y espacios.' });
    }

    const { rows } = await pool.query(`
        SELECT f.id, f.nombre, f.numero_identificacion, f.telefono, f.estado, f.fecha_creacion,
               ti.descripcion AS tipo_identificacion, g.descripcion AS genero, d.nombre AS departamento,
               s.situacion, u.email
        FROM formularios f
        JOIN usuarios u ON u.id = f.usuario_id
        LEFT JOIN tipos_identificacion ti ON ti.id = f.tipo_identificacion_id
        LEFT JOIN generos g ON g.id = f.genero_id
        LEFT JOIN departamentos d ON d.id = f.departamento_id
        LEFT JOIN situaciones s ON s.id = f.situacion_id
        WHERE f.nombre ILIKE $1 OR f.numero_identificacion ILIKE $1
        ORDER BY f.fecha_creacion DESC
        LIMIT 500
    `, ['%' + q.replace(/[\\%_]/g, '\\$&') + '%']);

    // Solo quien tiene la bandeja puede ver los tickets de otras personas
    const verTickets = tienePermiso(req, 'tickets.ver_todos');
    const beneficiarios = new Map();
    for (const fila of rows) {
        const clave = fila.numero_identificacion
            ? `${fila.tipo_identificacion}|${fila.numero_identificacion}`
            : `ticket-${fila.id}`;
        if (!beneficiarios.has(clave)) {
            // Las filas vienen de la más reciente a la más antigua: se toman los datos más recientes
            beneficiarios.set(clave, {
                nombre: fila.nombre,
                tipoIdentificacion: fila.tipo_identificacion,
                numeroIdentificacion: fila.numero_identificacion,
                genero: fila.genero,
                telefono: fila.telefono,
                departamento: fila.departamento,
                email: fila.email,
                totalTickets: 0,
                tickets: verTickets ? [] : null
            });
        }
        const beneficiario = beneficiarios.get(clave);
        beneficiario.totalTickets++;
        if (verTickets) {
            beneficiario.tickets.push({
                id: fila.id, situacion: fila.situacion, estado: fila.estado, fechaCreacion: fila.fecha_creacion
            });
        }
    }

    res.json([...beneficiarios.values()].slice(0, 50));
});

// Indicadores del panel de inicio según lo que el rol puede ver
router.get('/api/panel/resumen', requireLogin, async (req, res) => {
    const indicadores = [];

    if (tienePermiso(req, 'tickets.ver_todos')) {
        const { rows: [r] } = await pool.query(`
            SELECT COUNT(*) FILTER (WHERE estado <> 'Cerrado')::int AS abiertos,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado' AND funcionario_id IS NULL)::int AS sin_asignar,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado' AND funcionario_id = $1)::int AS mios,
                   COUNT(*) FILTER (WHERE fecha_cierre >= NOW() - INTERVAL '30 days')::int AS cerrados_30
            FROM formularios
        `, [req.usuario.id]);
        indicadores.push(
            { nombre: 'Tickets abiertos', valor: r.abiertos, ruta: '/gestion' },
            { nombre: 'Sin asignar', valor: r.sin_asignar, ruta: '/gestion?asignado=sin', alerta: r.sin_asignar > 0 },
            { nombre: 'Asignados a mí', valor: r.mios, ruta: '/gestion?asignado=yo' },
            { nombre: 'Cerrados en 30 días', valor: r.cerrados_30 }
        );
    } else if (tienePermiso(req, 'tickets.ver_propios')) {
        const { rows: [r] } = await pool.query(`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado')::int AS abiertos,
                   COUNT(*) FILTER (WHERE estado = 'Cerrado')::int AS cerrados
            FROM formularios WHERE usuario_id = $1
        `, [req.usuario.id]);
        indicadores.push(
            { nombre: 'Mis tickets', valor: r.total, ruta: '/validar' },
            { nombre: 'En atención', valor: r.abiertos, ruta: '/validar' },
            { nombre: 'Cerrados', valor: r.cerrados, ruta: '/validar' }
        );
    }

    res.json(indicadores);
});

// Meta de cierre (ANS) en días según la situación
const META_ANS = { 'Violencia contra la mujer': 5, 'Maltrato intrafamiliar': 10, 'Desplazamiento forzado': 20 };
const ANS_SQL = `CASE situacion ${Object.entries(META_ANS).map(([s, d]) => `WHEN '${s}' THEN ${d}`).join(' ')} END`;

// Definición de los KPI (documento "Datos, métricas y KPI"). sentido: si el valor debe ser
// mayor o igual ('min') o menor o igual ('max'). decimales: los que se muestran (1 si no se indica).
const KPIS = [
    { id: 'K1', perspectiva: 'Procesos', nombre: 'Tiempo de primera asignación', formula: 'Mediana de horas entre la creación del ticket y su primera asignación', frecuencia: 'Semanal', unidad: 'h', meta: 12, sentido: 'max' },
    { id: 'K2', perspectiva: 'Procesos', nombre: 'Asignación oportuna', formula: 'Tickets asignados en 24 horas o menos / tickets asignados × 100', frecuencia: 'Semanal', unidad: '%', meta: 90, sentido: 'min' },
    { id: 'K3', perspectiva: 'Procesos', nombre: 'Cumplimiento del ANS de cierre', formula: 'Tickets cerrados dentro de la meta de su situación (5, 10 o 20 días) / tickets cerrados × 100', frecuencia: 'Mensual', unidad: '%', meta: 80, sentido: 'min' },
    { id: 'K4', perspectiva: 'Procesos', nombre: 'Tickets sin asignar', formula: 'Número de tickets abiertos sin funcionario responsable', frecuencia: 'Diaria', unidad: '', meta: 20, sentido: 'max', actual: true, decimales: 0 },
    { id: 'K5', perspectiva: 'Procesos', nombre: 'Tickets estancados', formula: 'Número de tickets abiertos con más de 60 días', frecuencia: 'Semanal', unidad: '', meta: 0, sentido: 'max', actual: true, decimales: 0 },
    { id: 'K6', perspectiva: 'Calidad', nombre: 'Tasa de reapertura', formula: 'Tickets reabiertos / tickets cerrados × 100', frecuencia: 'Mensual', unidad: '%', meta: 5, sentido: 'max', decimales: 2 },
    { id: 'K7', perspectiva: 'Calidad', nombre: 'Cobertura de seguimiento', formula: 'Tickets asignados con al menos un comentario del funcionario / tickets asignados × 100', frecuencia: 'Mensual', unidad: '%', meta: 90, sentido: 'min' },
    { id: 'K8', perspectiva: 'Usuario', nombre: 'Satisfacción (CSAT)', formula: 'Encuestas con calificación 4 o 5 / encuestas × 100', frecuencia: 'Mensual', unidad: '%', meta: 85, sentido: 'min' },
    { id: 'K9', perspectiva: 'Usuario', nombre: 'Net Promoter Score (NPS)', formula: '% de promotores (9-10) − % de detractores (0-6)', frecuencia: 'Trimestral', unidad: '', meta: 30, sentido: 'min', min: -100, max: 100 },
    { id: 'K10', perspectiva: 'Usuario', nombre: 'Tasa de respuesta de encuestas', formula: 'Encuestas respondidas / tickets cerrados × 100', frecuencia: 'Mensual', unidad: '%', meta: 40, sentido: 'min' },
    { id: 'K11', perspectiva: 'Impacto', nombre: 'Recurrencia', formula: 'Tickets de personas con solicitudes previas / tickets × 100 (alerta si una situación supera 15 %)', frecuencia: 'Trimestral', unidad: '%', meta: 10, sentido: 'max', alerta: 15 },
    { id: 'K12', perspectiva: 'Impacto', nombre: 'Cobertura territorial', formula: 'Departamentos con al menos un ticket en el periodo / 33 × 100', frecuencia: 'Trimestral', unidad: '%', meta: 100, sentido: 'min' },
    { id: 'K13', perspectiva: 'Plataforma', nombre: 'Disponibilidad', formula: 'Tiempo en que la plataforma responde correctamente / tiempo total × 100', frecuencia: 'Mensual', unidad: '%', meta: 99, sentido: 'min' }
];

// Cumple al llegar a la meta, está en riesgo si le falta menos del 10 % y no cumple en los demás casos
function estadoKpi(kpi, valor) {
    if (valor === null || valor === undefined) return 'pendiente';
    const holgura = Math.abs(kpi.meta) * 0.1;
    if (kpi.sentido === 'min') {
        if (valor >= kpi.meta) return 'cumple';
        return valor >= kpi.meta - holgura ? 'riesgo' : 'no_cumple';
    }
    if (valor <= kpi.meta) return 'cumple';
    return holgura > 0 && valor <= kpi.meta + holgura ? 'riesgo' : 'no_cumple';
}

const PERIODOS = { todo: null, 365: 365, 90: 90, 30: 30 };
const redondear = (valor, decimales = 1) => valor === null || valor === undefined ? null : Math.round(valor * 10 ** decimales) / 10 ** decimales;

// Tablero de estadísticas y KPI (HU15). Los indicadores de flujo usan los tickets creados en el
// periodo; los de inventario (abiertos, sin asignar, estancados) muestran la situación de hoy.
router.get('/api/estadisticas', requirePermiso('estadisticas.ver'), async (req, res) => {
    const periodo = Object.hasOwn(PERIODOS, req.query.periodo) ? req.query.periodo : 'todo';
    const dias = PERIODOS[periodo];
    const granularidad = dias !== null && dias <= 90 ? 'week' : 'month';
    // La vista de minería ya trae las fechas en hora de Colombia
    const ventana = `WITH v AS (
        SELECT * FROM vista_mineria_tickets
        WHERE $1::int IS NULL OR fecha_creacion >= (NOW() AT TIME ZONE 'America/Bogota') - make_interval(days => $1::int)
    )`;

    const [resumen, actual, recurrencia, serie, porSituacion, porDepartamento, cierre, csatTiempo, porEstado, porResponsable] = await Promise.all([
        pool.query(`${ventana}
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE estado = 'Cerrado')::int AS cerrados,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY horas_hasta_asignacion) AS k1,
                   COUNT(*) FILTER (WHERE horas_hasta_asignacion <= 24) * 100.0 / NULLIF(COUNT(horas_hasta_asignacion), 0) AS k2,
                   COUNT(*) FILTER (WHERE estado = 'Cerrado' AND dias_hasta_cierre <= ${ANS_SQL}) * 100.0
                       / NULLIF(COUNT(*) FILTER (WHERE estado = 'Cerrado' AND dias_hasta_cierre IS NOT NULL), 0) AS k3,
                   COUNT(*) FILTER (WHERE reaperturas > 0) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE estado = 'Cerrado'), 0) AS k6,
                   COUNT(*) FILTER (WHERE funcionario_id IS NOT NULL AND comentarios > comentarios_solicitante) * 100.0
                       / NULLIF(COUNT(funcionario_id), 0) AS k7,
                   COUNT(*) FILTER (WHERE calificacion >= 4) * 100.0 / NULLIF(COUNT(calificacion), 0) AS k8,
                   (COUNT(*) FILTER (WHERE recomienda >= 9) - COUNT(*) FILTER (WHERE recomienda <= 6)) * 100.0
                       / NULLIF(COUNT(recomienda), 0) AS k9,
                   COUNT(*) FILTER (WHERE tiene_encuesta) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE estado = 'Cerrado'), 0) AS k10,
                   COUNT(*) FILTER (WHERE tickets_previos_usuario > 0) * 100.0 / NULLIF(COUNT(*), 0) AS k11,
                   COUNT(DISTINCT departamento) * 100.0 / (SELECT COUNT(*) FROM departamentos) AS k12,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dias_hasta_cierre) AS mediana_cierre,
                   COUNT(calificacion)::int AS encuestas,
                   COUNT(*) FILTER (WHERE recomienda <= 6)::int AS detractores,
                   COUNT(*) FILTER (WHERE recomienda BETWEEN 7 AND 8)::int AS pasivos,
                   COUNT(*) FILTER (WHERE recomienda >= 9)::int AS promotores,
                   AVG(calificacion) AS calificacion, AVG(rapidez) AS rapidez, AVG(amabilidad) AS amabilidad,
                   AVG(claridad) AS claridad, AVG(utilidad) AS utilidad
            FROM v
        `, [dias]),
        pool.query(`
            SELECT COUNT(*) FILTER (WHERE estado <> 'Cerrado')::int AS abiertos,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado' AND funcionario_id IS NULL)::int AS k4,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado' AND fecha_creacion < NOW() - INTERVAL '60 days')::int AS k5
            FROM formularios
        `),
        pool.query(`${ventana}
            SELECT situacion AS nombre, COUNT(*) FILTER (WHERE tickets_previos_usuario > 0) * 100.0 / COUNT(*) AS valor
            FROM v WHERE situacion IS NOT NULL GROUP BY situacion
        `, [dias]),
        pool.query(`${ventana}
            SELECT TO_CHAR(DATE_TRUNC($2, fecha_creacion), 'YYYY-MM-DD') AS periodo,
                   COALESCE(situacion, 'Sin dato') AS situacion, COUNT(*)::int AS total
            FROM v GROUP BY 1, 2 ORDER BY 1
        `, [dias, granularidad]),
        pool.query(`${ventana}
            SELECT COALESCE(situacion, 'Sin dato') AS nombre, COUNT(*)::int AS total FROM v GROUP BY 1 ORDER BY 2 DESC
        `, [dias]),
        pool.query(`${ventana}
            SELECT COALESCE(departamento, 'Sin dato') AS nombre, COUNT(*)::int AS total FROM v GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        `, [dias]),
        pool.query(`${ventana}
            SELECT situacion AS nombre, COUNT(*)::int AS cerrados,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dias_hasta_cierre) AS mediana,
                   COUNT(*) FILTER (WHERE dias_hasta_cierre <= ${ANS_SQL}) * 100.0 / COUNT(*) AS cumple
            FROM v WHERE estado = 'Cerrado' AND dias_hasta_cierre IS NOT NULL AND situacion IS NOT NULL
            GROUP BY situacion
        `, [dias]),
        pool.query(`${ventana}
            SELECT CASE WHEN dias_hasta_cierre <= 5 THEN 1 WHEN dias_hasta_cierre <= 10 THEN 2
                        WHEN dias_hasta_cierre <= 20 THEN 3 WHEN dias_hasta_cierre <= 40 THEN 4 ELSE 5 END AS rango,
                   COUNT(*)::int AS encuestas,
                   COUNT(*) FILTER (WHERE calificacion >= 4) * 100.0 / COUNT(*) AS csat
            FROM v WHERE calificacion IS NOT NULL AND dias_hasta_cierre IS NOT NULL
            GROUP BY 1 ORDER BY 1
        `, [dias]),
        pool.query(`SELECT estado AS nombre, COUNT(*)::int AS total FROM formularios GROUP BY estado`),
        pool.query(`
            SELECT CONCAT_WS(' ', u.nombre, u.apellido) AS nombre, COUNT(*)::int AS total
            FROM formularios f JOIN usuarios u ON u.id = f.funcionario_id
            WHERE f.estado <> 'Cerrado'
            GROUP BY u.id, u.nombre, u.apellido ORDER BY 2 DESC, 1 LIMIT 10
        `)
    ]);

    const r = resumen.rows[0];
    const a = actual.rows[0];
    const valores = {
        K1: r.k1, K2: r.k2, K3: r.k3, K4: a.k4, K5: a.k5, K6: r.k6, K7: r.k7, K8: r.k8,
        K9: r.k9, K10: r.k10, K11: r.k11, K12: r.k12, K13: null // Aún no hay monitoreo de disponibilidad
    };
    const recurrenciaMax = recurrencia.rows
        .map(s => ({ nombre: s.nombre, valor: Number(s.valor) }))
        .reduce((max, s) => (!max || s.valor > max.valor ? s : max), null);

    const kpis = KPIS.map(kpi => {
        const valor = redondear(valores[kpi.id] === null ? null : Number(valores[kpi.id]), kpi.decimales ?? 1);
        let estado = estadoKpi(kpi, valor);
        let nota = kpi.actual ? 'Situación de hoy' : null;
        if (kpi.id === 'K11' && recurrenciaMax && recurrenciaMax.valor > kpi.alerta) {
            nota = `${recurrenciaMax.nombre}: ${redondear(recurrenciaMax.valor)} %`;
            if (estado === 'cumple') estado = 'alerta';
        }
        if (kpi.id === 'K13') nota = 'Sin medición: falta un servicio de monitoreo';
        return { ...kpi, valor, estado, nota };
    });

    // Se descartan el primer y el último periodo de la serie porque están incompletos
    const periodos = [...new Set(serie.rows.map(f => f.periodo))];
    const completos = new Set(periodos.slice(1, -1));

    const conteoEstado = Object.fromEntries(porEstado.rows.map(e => [e.nombre, e.total]));
    res.json({
        periodo,
        granularidad,
        total: r.total,
        cerrados: r.cerrados,
        abiertos: a.abiertos,
        sinAsignar: a.k4,
        medianaCierre: redondear(r.mediana_cierre),
        kpis,
        serie: serie.rows.filter(f => completos.has(f.periodo)),
        porSituacion: porSituacion.rows,
        porDepartamento: porDepartamento.rows,
        cierrePorSituacion: cierre.rows.map(c => ({
            nombre: c.nombre, cerrados: c.cerrados, mediana: redondear(c.mediana), cumple: redondear(Number(c.cumple)), meta: META_ANS[c.nombre]
        })).sort((x, y) => x.meta - y.meta),
        csatPorTiempo: csatTiempo.rows.map(f => ({
            rango: ['5 días o menos', '6 a 10 días', '11 a 20 días', '21 a 40 días', 'Más de 40 días'][f.rango - 1],
            encuestas: f.encuestas,
            csat: redondear(Number(f.csat))
        })),
        aspectos: [
            { nombre: 'Amabilidad', valor: r.amabilidad }, { nombre: 'Claridad', valor: r.claridad },
            { nombre: 'Utilidad', valor: r.utilidad }, { nombre: 'Rapidez', valor: r.rapidez }
        ].map(x => ({ ...x, valor: redondear(x.valor === null ? null : Number(x.valor), 2) })),
        calificacionPromedio: redondear(r.calificacion === null ? null : Number(r.calificacion), 2),
        nps: { detractores: r.detractores, pasivos: r.pasivos, promotores: r.promotores },
        // Todos los estados aparecen, aunque tengan 0 tickets
        porEstado: ['Pendiente', 'En proceso', 'Resuelto', 'Cerrado'].map(nombre => ({ nombre, total: conteoEstado[nombre] || 0 })),
        porResponsable: porResponsable.rows
    });
});

module.exports = router;
