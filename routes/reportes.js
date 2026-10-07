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

// Estadísticas de los tickets (HU15)
router.get('/api/estadisticas', requirePermiso('estadisticas.ver'), async (req, res) => {
    const [resumen, porEstado, porSituacion, porDepartamento, porResponsable] = await Promise.all([
        pool.query(`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado')::int AS abiertos,
                   COUNT(*) FILTER (WHERE estado <> 'Cerrado' AND funcionario_id IS NULL)::int AS sin_asignar,
                   COUNT(*) FILTER (WHERE fecha_creacion >= NOW() - INTERVAL '30 days')::int AS ultimos_30_dias,
                   ROUND((AVG(EXTRACT(EPOCH FROM fecha_cierre - fecha_creacion) / 86400)
                          FILTER (WHERE fecha_cierre IS NOT NULL))::numeric, 1)::float AS promedio_dias_cierre
            FROM formularios
        `),
        pool.query(`SELECT estado AS nombre, COUNT(*)::int AS total FROM formularios GROUP BY estado`),
        pool.query(`
            SELECT COALESCE(s.situacion, 'Sin dato') AS nombre, COUNT(*)::int AS total
            FROM formularios f LEFT JOIN situaciones s ON s.id = f.situacion_id
            GROUP BY 1 ORDER BY 2 DESC
        `),
        pool.query(`
            SELECT COALESCE(d.nombre, 'Sin dato') AS nombre, COUNT(*)::int AS total
            FROM formularios f LEFT JOIN departamentos d ON d.id = f.departamento_id
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        `),
        pool.query(`
            SELECT CONCAT_WS(' ', u.nombre, u.apellido) AS nombre, COUNT(*)::int AS total
            FROM formularios f JOIN usuarios u ON u.id = f.funcionario_id
            WHERE f.estado <> 'Cerrado'
            GROUP BY u.id, u.nombre, u.apellido ORDER BY 2 DESC
        `)
    ]);

    // Todos los estados aparecen, aunque tengan 0 tickets
    const conteo = Object.fromEntries(porEstado.rows.map(e => [e.nombre, e.total]));
    res.json({
        ...resumen.rows[0],
        porEstado: ['Pendiente', 'En proceso', 'Resuelto', 'Cerrado'].map(nombre => ({ nombre, total: conteo[nombre] || 0 })),
        porSituacion: porSituacion.rows,
        porDepartamento: porDepartamento.rows,
        porResponsable: porResponsable.rows
    });
});

module.exports = router;
