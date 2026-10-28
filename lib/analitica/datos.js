// Carga los tickets de la base de datos y calcula las variables derivadas que usan
// los tres análisis (grupos, reglas y riesgo de demora).
//
// Todas las variables "de creación" (situación, departamento, congestión...) son lo
// que se sabía en el momento de crear el ticket. Así el modelo de riesgo puede
// usarlas para tickets que todavía están abiertos sin hacer trampa con el futuro.

const { META_ANS } = require('../ans');

const SEGUNDOS_DIA = 86400;
const VENTANA_LLEGADAS_DIAS = 7;
const EXTRANJEROS = new Set(['Cédula de extranjería', 'Pasaporte', 'Permiso por Protección Temporal (PPT)']);
const MENORES = new Set(['Tarjeta de identidad', 'Registro civil']);

// Una fila por ticket. Las fechas viajan como segundos desde 1970 y las variables de
// calendario (mes, día, hora) se calculan en hora de Colombia, igual que la vista de minería.
const SQL_TICKETS = `
    SELECT f.id,
           f.usuario_id AS "usuarioId",
           s.situacion,
           d.nombre AS departamento,
           g.descripcion AS genero,
           ti.descripcion AS "tipoId",
           f.estado,
           EXTRACT(EPOCH FROM f.fecha_creacion)::float8 AS creado,
           EXTRACT(EPOCH FROM f.fecha_cierre)::float8 AS cerrado,
           EXTRACT(MONTH FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS mes,
           EXTRACT(ISODOW FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS "diaSemana",
           EXTRACT(HOUR FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS hora,
           f.cantidad,
           f.funcionario_id AS "funcionarioId",
           (SELECT EXTRACT(EPOCH FROM MIN(h.fecha) - f.fecha_creacion) / 3600 FROM ticket_historial h
            WHERE h.formulario_id = f.id AND h.accion = 'Asignación')::float8 AS "horasAsignacion",
           COUNT(*) OVER (
               PARTITION BY f.usuario_id ORDER BY f.fecha_creacion, f.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           )::int AS previos,
           (SELECT COUNT(*) FROM ticket_historial h
            WHERE h.formulario_id = f.id AND h.accion = 'Reapertura')::int AS reaperturas,
           (SELECT e.calificacion FROM encuestas_satisfaccion e
            WHERE e.formulario_id = f.id ORDER BY e.fecha_creacion DESC LIMIT 1) AS calificacion
    FROM formularios f
    LEFT JOIN situaciones s ON s.id = f.situacion_id
    LEFT JOIN departamentos d ON d.id = f.departamento_id
    LEFT JOIN generos g ON g.id = f.genero_id
    LEFT JOIN tipos_identificacion ti ON ti.id = f.tipo_identificacion_id
    ORDER BY f.fecha_creacion, f.id
`;

// Lee los tickets y la hora actual de la base de datos (la misma fuente de las fechas)
async function cargarTickets(pool) {
    const [tickets, reloj] = await Promise.all([
        pool.query(SQL_TICKETS),
        pool.query('SELECT EXTRACT(EPOCH FROM NOW())::float8 AS ahora')
    ]);
    return prepararTickets(tickets.rows, reloj.rows[0].ahora);
}

// Cuántos valores de la lista ordenada son menores que x (búsqueda binaria)
function contarMenores(ordenada, x) {
    let bajo = 0, alto = ordenada.length;
    while (bajo < alto) {
        const medio = (bajo + alto) >> 1;
        if (ordenada[medio] < x) bajo = medio + 1; else alto = medio;
    }
    return bajo;
}

// Cuántos valores de la lista ordenada son menores o iguales que x
function contarHasta(ordenada, x) {
    let bajo = 0, alto = ordenada.length;
    while (bajo < alto) {
        const medio = (bajo + alto) >> 1;
        if (ordenada[medio] <= x) bajo = medio + 1; else alto = medio;
    }
    return bajo;
}

function franjaHoraria(hora) {
    if (hora < 6) return 'Madrugada';
    if (hora < 12) return 'Mañana';
    if (hora < 18) return 'Tarde';
    return 'Noche';
}

// Completa cada fila con sus variables derivadas.
//   ahora: instante actual en segundos desde 1970
//
// Etiqueta de demora (lo que predice el modelo de riesgo):
//   1 = el ticket superó la meta de cierre (ANS) de su situación, 0 = se cerró a tiempo.
//   Solo se conoce con certeza cuando el plazo ya venció: un ticket cerrado dentro del plazo es 0,
//   uno cerrado después es 1 y uno que sigue abierto pasado el plazo es 1. Los tickets que todavía
//   están dentro de su plazo quedan en null, porque un ticket reciente que sigue abierto
//   aún podría cerrarse a tiempo.
function prepararTickets(filas, ahora) {
    const tickets = filas.map(f => {
        const cerradoOk = f.estado === 'Cerrado' && f.cerrado !== null && f.cerrado !== undefined;
        const ans = META_ANS[f.situacion] ?? null;
        const duracionDias = cerradoOk ? (f.cerrado - f.creado) / SEGUNDOS_DIA : null;
        const edadDias = (ahora - f.creado) / SEGUNDOS_DIA;
        const abierto = f.estado !== 'Cerrado';

        let etiqueta = null;
        if (ans !== null && edadDias > ans) {
            if (cerradoOk) etiqueta = duracionDias > ans ? 1 : 0;
            else if (abierto) etiqueta = 1;
        }

        return {
            id: f.id,
            usuarioId: f.usuarioId,
            situacion: f.situacion ?? null,
            departamento: f.departamento ?? null,
            genero: f.genero ?? null,
            tipoId: f.tipoId ?? null,
            estado: f.estado,
            creado: f.creado,
            cerrado: cerradoOk ? f.cerrado : null,
            mes: f.mes,
            diaSemana: f.diaSemana,
            hora: f.hora,
            franja: franjaHoraria(f.hora),
            finSemana: f.diaSemana >= 6,
            extranjero: EXTRANJEROS.has(f.tipoId),
            menor: MENORES.has(f.tipoId),
            tierra: f.cantidad !== null && f.cantidad !== undefined,
            // Se conocen solo cuando el ticket ya tiene responsable
            funcionarioId: f.funcionarioId ?? null,
            horasAsignacion: f.horasAsignacion ?? null,
            previos: f.previos,
            reincidente: f.previos > 0,
            reaperturas: f.reaperturas,
            calificacion: f.calificacion ?? null,
            abierto,
            cerradoOk,
            ans,
            duracionDias,
            edadDias,
            etiqueta,
            // Se completan abajo
            congestion: 0,
            llegadasDepto: 0
        };
    });

    // Congestión al crear el ticket: cuántos tickets había abiertos en ese momento.
    // Son los creados antes menos los que ya estaban cerrados (los reabiertos cuentan como
    // cerrados hasta su cierre final; es una aproximación suficiente para medir congestión).
    const creaciones = Float64Array.from(tickets, t => t.creado).sort();
    const cierres = Float64Array.from(tickets.filter(t => t.cerrado !== null), t => t.cerrado).sort();
    for (const t of tickets) {
        t.congestion = Math.max(0, contarMenores(creaciones, t.creado) - contarHasta(cierres, t.creado));
    }

    // Picos de demanda: tickets del mismo departamento en los 7 días anteriores
    const porDepartamento = new Map();
    for (const t of tickets) {
        if (t.departamento === null) continue;
        if (!porDepartamento.has(t.departamento)) porDepartamento.set(t.departamento, []);
        porDepartamento.get(t.departamento).push(t.creado);
    }
    for (const lista of porDepartamento.values()) lista.sort((a, b) => a - b);
    for (const t of tickets) {
        if (t.departamento === null) continue;
        const lista = porDepartamento.get(t.departamento);
        const desde = t.creado - VENTANA_LLEGADAS_DIAS * SEGUNDOS_DIA;
        t.llegadasDepto = contarMenores(lista, t.creado) - contarMenores(lista, desde);
    }

    return { tickets, ahora };
}

module.exports = { cargarTickets, prepararTickets, SQL_TICKETS, VENTANA_LLEGADAS_DIAS };
