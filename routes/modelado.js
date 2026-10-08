const express = require('express');
const { pool } = require('../DB/db');
const { requirePermiso } = require('../middleware/auth');

const router = express.Router();

// Ventanas de observación permitidas (días completos antes de hoy)
const VENTANAS = [30, 90, 180, 365];

// Parámetros del sistema de atención estimados con los datos reales, para alimentar
// el modelo determinístico y la simulación estocástica de /modelado.
// El sistema se ve como una cola: llegan tickets (λ por día), c funcionarios los cierran
// a un ritmo μ por funcionario y por día, y lo que no se cierra queda pendiente (backlog).
router.get('/api/modelado/parametros', requirePermiso('modelado.ver'), async (req, res) => {
    const dias = VENTANAS.includes(Number(req.query.dias)) ? Number(req.query.dias) : 90;

    const [serie, cierres, backlog, funcionarios] = await Promise.all([
        // Llegadas y cierres de cada día de la ventana, en hora de Colombia (incluye los días en 0)
        pool.query(`
            WITH dias AS (
                SELECT generate_series(
                    (NOW() AT TIME ZONE 'America/Bogota')::date - $1::int,
                    (NOW() AT TIME ZONE 'America/Bogota')::date - 1,
                    INTERVAL '1 day')::date AS dia
            )
            SELECT TO_CHAR(d.dia, 'YYYY-MM-DD') AS dia,
                   (SELECT COUNT(*) FROM formularios f
                    WHERE (f.fecha_creacion AT TIME ZONE 'America/Bogota')::date = d.dia)::int AS llegadas,
                   (SELECT COUNT(*) FROM formularios f
                    WHERE (f.fecha_cierre AT TIME ZONE 'America/Bogota')::date = d.dia)::int AS cierres
            FROM dias d
            ORDER BY d.dia
        `, [dias]),
        // Tickets cerrados en la ventana: quién los atendió y cuánto tardaron
        pool.query(`
            SELECT COUNT(DISTINCT funcionario_id)::int AS funcionarios_activos,
                   ROUND(AVG(EXTRACT(EPOCH FROM fecha_cierre - fecha_creacion) / 86400)::numeric, 2)::float AS promedio_dias,
                   ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM fecha_cierre - fecha_creacion) / 86400))::numeric, 2)::float AS mediana_dias,
                   ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM fecha_cierre - fecha_creacion) / 86400))::numeric, 2)::float AS p90_dias
            FROM formularios
            WHERE fecha_cierre >= ((NOW() AT TIME ZONE 'America/Bogota')::date - $1::int) AT TIME ZONE 'America/Bogota'
              AND fecha_cierre < (NOW() AT TIME ZONE 'America/Bogota')::date AT TIME ZONE 'America/Bogota'
        `, [dias]),
        pool.query(`SELECT COUNT(*)::int AS abiertos FROM formularios WHERE estado <> 'Cerrado'`),
        // Cuentas activas que pueden cerrar tickets (sin contar administradores)
        pool.query(`
            SELECT COUNT(*)::int AS total
            FROM usuarios u
            JOIN roles r ON r.id = u.rol_id
            WHERE u.activo AND NOT r.es_admin
              AND EXISTS (SELECT 1 FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                          WHERE rp.rol_id = r.id AND p.codigo = 'tickets.cerrar')
        `)
    ]);

    const llegadas = serie.rows.map(r => r.llegadas);
    const totalCierres = serie.rows.reduce((s, r) => s + r.cierres, 0);
    const media = llegadas.reduce((s, x) => s + x, 0) / dias;
    const varianza = llegadas.reduce((s, x) => s + (x - media) ** 2, 0) / Math.max(dias - 1, 1);
    const c = cierres.rows[0];

    res.json({
        dias,
        serie: serie.rows.map(r => ({ dia: r.dia, llegadas: r.llegadas, cierres: r.cierres })),
        llegadasDia: round(media),
        varianzaLlegadas: round(varianza),
        cierresDia: round(totalCierres / dias),
        funcionariosActivos: c.funcionarios_activos,
        funcionariosHabilitados: funcionarios.rows[0].total,
        // Productividad: cierres por funcionario y por día
        cierresFuncionarioDia: c.funcionarios_activos ? round(totalCierres / dias / c.funcionarios_activos) : 0,
        backlog: backlog.rows[0].abiertos,
        tiempoCierre: { promedio: c.promedio_dias, mediana: c.mediana_dias, p90: c.p90_dias }
    });
});

function round(valor, decimales = 2) {
    const factor = 10 ** decimales;
    return Math.round(valor * factor) / factor;
}

module.exports = router;
