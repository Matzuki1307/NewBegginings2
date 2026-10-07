const express = require('express');
const { pool, transaccion } = require('../DB/db');
const { requireLogin, requirePermiso, tienePermiso } = require('../middleware/auth');
const { obtenerCamposRol } = require('../lib/configuracion');
const { limpiar, esTelefono, esNumeroIdentificacion, esEnteroPositivo } = require('../lib/validacion');

const router = express.Router();

const ESTADOS = ['Pendiente', 'En proceso', 'Resuelto', 'Cerrado'];
// 'Cerrado' solo se alcanza con la acción de cerrar, que exige una observación (HU13)
const ESTADOS_EDITABLES = ['Pendiente', 'En proceso', 'Resuelto'];
// Campos que solo aplican cuando la situación es desplazamiento forzado
const CAMPOS_DESPLAZAMIENTO = ['unidadMedida', 'cantidad'];

async function registrarHistorial(db, ticketId, usuarioId, accion, detalle) {
    await db.query(
        'INSERT INTO ticket_historial (formulario_id, usuario_id, accion, detalle) VALUES ($1, $2, $3, $4)',
        [ticketId, usuarioId, accion, detalle]);
}

// Busca el ticket y comprueba que el usuario pueda verlo: el propio o, con
// permiso de bandeja, cualquiera (HU4). Si no, responde el error y devuelve null.
async function obtenerTicketAutorizado(req, res) {
    if (!esEnteroPositivo(req.params.id)) {
        res.status(400).json({ error: 'Identificador de ticket no válido.' });
        return null;
    }
    const { rows } = await pool.query('SELECT * FROM formularios WHERE id = $1', [req.params.id]);
    const ticket = rows[0];
    if (!ticket) {
        res.status(404).json({ error: 'El ticket no existe.' });
        return null;
    }
    const esPropio = ticket.usuario_id === req.usuario.id && tienePermiso(req, 'tickets.ver_propios');
    if (!esPropio && !tienePermiso(req, 'tickets.ver_todos')) {
        res.status(403).json({ error: 'No tienes acceso a este ticket.' });
        return null;
    }
    return ticket;
}

// Usuarios activos que pueden atender tickets (tienen la bandeja o son administradores)
async function buscarFuncionarios(id = null) {
    const { rows } = await pool.query(`
        SELECT u.id, u.nombre, u.apellido, r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id = u.rol_id
        WHERE u.activo
          AND (r.es_admin OR EXISTS (
                SELECT 1 FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                WHERE rp.rol_id = r.id AND p.codigo = 'tickets.ver_todos'))
          AND ($1::int IS NULL OR u.id = $1)
        ORDER BY u.nombre, u.apellido
    `, [id]);
    return rows;
}

// Escapa los comodines de LIKE para buscar el texto tal cual
function patronBusqueda(texto) {
    return '%' + texto.replace(/[\\%_]/g, '\\$&') + '%';
}

// ===== Creación de tickets (HU3) =====

// Configuración de los campos del formulario para el rol del usuario (HU9)
router.get('/api/formulario/campos', requirePermiso('tickets.crear'), async (req, res) => {
    const campos = await obtenerCamposRol(req.usuario.rol_id);
    res.json(campos.map(({ codigo, etiqueta, visible, habilitado, obligatorio }) =>
        ({ codigo, etiqueta, visible, habilitado, obligatorio })));
});

// Ruta para manejar el formulario
router.post('/api/formulario', requirePermiso('tickets.crear'), async (req, res) => {
    const campos = await obtenerCamposRol(req.usuario.rol_id);

    // Solo se aceptan los campos que el rol puede ver y modificar
    const valores = {};
    for (const campo of campos) {
        valores[campo.codigo] = campo.visible && campo.habilitado ? limpiar(req.body[campo.codigo]) : null;
    }

    let esDesplazamiento = false;
    if (valores.situacionId !== null) {
        const situacion = esEnteroPositivo(valores.situacionId)
            ? (await pool.query('SELECT situacion FROM situaciones WHERE id = $1', [valores.situacionId])).rows[0]
            : null;
        if (!situacion) {
            return res.status(400).json({ error: 'La situación seleccionada no es válida.' });
        }
        esDesplazamiento = situacion.situacion === 'Desplazamiento forzado';
    }
    if (!esDesplazamiento) {
        CAMPOS_DESPLAZAMIENTO.forEach(codigo => { valores[codigo] = null; });
    }

    const faltantes = campos
        .filter(c => c.visible && c.habilitado && c.obligatorio)
        .filter(c => esDesplazamiento || !CAMPOS_DESPLAZAMIENTO.includes(c.codigo))
        .filter(c => valores[c.codigo] === null)
        .map(c => c.etiqueta);
    if (faltantes.length > 0) {
        return res.status(400).json({ error: `Faltan datos obligatorios: ${faltantes.join(', ')}.`, faltantes });
    }

    // Datos no permitidos
    const errores = [];
    if (valores.nombre !== null && String(valores.nombre).length > 200) {
        errores.push('El nombre no puede superar 200 caracteres.');
    }
    if (valores.numeroId !== null && !esNumeroIdentificacion(valores.numeroId)) {
        errores.push('El número de identificación solo puede tener letras, números y guiones (3 a 20 caracteres).');
    }
    if (valores.telefono !== null && !esTelefono(valores.telefono)) {
        errores.push('El teléfono solo puede tener números (7 a 15 dígitos).');
    }
    for (const codigo of ['tipoId', 'genero', 'departamento', 'unidadMedida']) {
        if (valores[codigo] !== null && !esEnteroPositivo(valores[codigo])) {
            errores.push(`El valor de "${campos.find(c => c.codigo === codigo).etiqueta}" no es válido.`);
        }
    }
    if (valores.cantidad !== null && !esEnteroPositivo(valores.cantidad)) {
        errores.push('La cantidad debe ser un número entero mayor que cero.');
    }
    if (errores.length > 0) {
        return res.status(400).json({ error: errores.join(' ') });
    }

    try {
        const ticket = await transaccion(async (db) => {
            const result = await db.query(`
                INSERT INTO formularios (nombre, tipo_identificacion_id, numero_identificacion, genero_id, telefono,
                                         situacion_id, departamento_id, unidad_medida_id, cantidad, usuario_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id AS "Id", fecha_creacion AS "FechaCreacion", estado AS "Estado"
            `, [valores.nombre, valores.tipoId, valores.numeroId, valores.genero, valores.telefono,
                valores.situacionId, valores.departamento, valores.unidadMedida, valores.cantidad, req.usuario.id]);
            await registrarHistorial(db, result.rows[0].Id, req.usuario.id, 'Creación', 'Ticket creado por el solicitante');
            return result.rows[0];
        });

        req.session.ticket = ticket;
        res.status(200).json({ mensaje: 'Formulario enviado con éxito.', ticket });
    } catch (error) {
        if (error.code === '23503') { // Llave foránea: un catálogo con un id que no existe
            return res.status(400).json({ error: 'Alguno de los datos seleccionados no es válido.' });
        }
        throw error;
    }
});

// Último ticket creado en esta sesión
router.get('/api/ticket', requireLogin, (req, res) => {
    if (!req.session.ticket) {
        return res.status(404).json({ error: 'No hay ticket reciente.' });
    }
    res.json(req.session.ticket);
});

// ===== Consulta de tickets (HU4 y bandeja de funcionarios) =====

// Tickets del usuario logueado
router.get('/api/mis-tickets', requirePermiso('tickets.ver_propios'), async (req, res) => {
    const result = await pool.query(`
        SELECT
            f.id             AS "Id",
            f.nombre         AS "Nombre",
            u.email          AS "Email",
            s.situacion      AS "Situacion",
            f.estado         AS "Estado",
            f.fecha_creacion AS "FechaCreacion"
        FROM formularios f
        INNER JOIN usuarios u ON f.usuario_id = u.id
        LEFT JOIN situaciones s ON f.situacion_id = s.id
        WHERE f.usuario_id = $1
        ORDER BY f.fecha_creacion DESC
    `, [req.usuario.id]);
    res.json(result.rows);
});

// Bandeja con los tickets de todos los usuarios, con filtros
router.get('/api/tickets', requirePermiso('tickets.ver_todos'), async (req, res) => {
    const estado = limpiar(req.query.estado);
    const asignado = limpiar(req.query.asignado); // 'yo' | 'sin'
    const q = limpiar(req.query.q);

    if (estado !== null && !ESTADOS.includes(estado)) {
        return res.status(400).json({ error: 'Estado no válido.' });
    }
    if (asignado !== null && !['yo', 'sin'].includes(asignado)) {
        return res.status(400).json({ error: 'Filtro de asignación no válido.' });
    }
    if (q !== null && q.length > 100) {
        return res.status(400).json({ error: 'La búsqueda es demasiado larga.' });
    }

    const { rows } = await pool.query(`
        SELECT f.id AS "Id", f.nombre AS "Nombre", f.numero_identificacion AS "NumeroId", u.email AS "Email",
               s.situacion AS "Situacion", d.nombre AS "Departamento", f.estado AS "Estado",
               f.fecha_creacion AS "FechaCreacion", f.funcionario_id AS "FuncionarioId",
               NULLIF(CONCAT_WS(' ', fu.nombre, fu.apellido), '') AS "Responsable"
        FROM formularios f
        JOIN usuarios u ON u.id = f.usuario_id
        LEFT JOIN situaciones s ON s.id = f.situacion_id
        LEFT JOIN departamentos d ON d.id = f.departamento_id
        LEFT JOIN usuarios fu ON fu.id = f.funcionario_id
        WHERE ($1::text IS NULL OR f.estado = $1)
          AND ($2::text IS NULL
               OR ($2 = 'sin' AND f.funcionario_id IS NULL)
               OR ($2 = 'yo' AND f.funcionario_id = $3))
          AND ($4::text IS NULL
               OR f.nombre ILIKE $4 OR f.numero_identificacion ILIKE $4 OR u.email ILIKE $4
               OR f.id::text = $5)
        ORDER BY f.fecha_creacion DESC
        LIMIT 200
    `, [estado, asignado, req.usuario.id, q && patronBusqueda(q), q && q.replace(/^T-/i, '')]);
    res.json(rows);
});

// Detalle de un ticket con las acciones que el usuario puede hacer sobre él
router.get('/api/tickets/:id', requireLogin, async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const { rows } = await pool.query(`
        SELECT f.id, f.nombre, f.numero_identificacion, f.telefono, f.cantidad, f.estado,
               f.fecha_creacion, f.fecha_actualizacion, f.fecha_cierre, f.observacion_cierre, f.funcionario_id,
               ti.descripcion AS tipo_identificacion, g.descripcion AS genero, s.situacion,
               d.nombre AS departamento, um.nombre AS unidad_medida, u.email AS email_solicitante,
               NULLIF(CONCAT_WS(' ', fu.nombre, fu.apellido), '') AS responsable,
               NULLIF(CONCAT_WS(' ', uc.nombre, uc.apellido), '') AS cerrado_por
        FROM formularios f
        JOIN usuarios u ON u.id = f.usuario_id
        LEFT JOIN tipos_identificacion ti ON ti.id = f.tipo_identificacion_id
        LEFT JOIN generos g ON g.id = f.genero_id
        LEFT JOIN situaciones s ON s.id = f.situacion_id
        LEFT JOIN departamentos d ON d.id = f.departamento_id
        LEFT JOIN unidades_medida um ON um.id = f.unidad_medida_id
        LEFT JOIN usuarios fu ON fu.id = f.funcionario_id
        LEFT JOIN usuarios uc ON uc.id = f.cerrado_por
        WHERE f.id = $1
    `, [ticket.id]);

    const cerrado = ticket.estado === 'Cerrado';
    const esPropio = ticket.usuario_id === req.usuario.id;
    res.json({
        ...rows[0],
        acciones: {
            cambiarEstado: tienePermiso(req, 'tickets.cambiar_estado') && (!cerrado || tienePermiso(req, 'tickets.cerrar')),
            asignar: tienePermiso(req, 'tickets.asignar') && !cerrado,
            cerrar: tienePermiso(req, 'tickets.cerrar') && !cerrado,
            comentar: tienePermiso(req, 'tickets.comentar'),
            verHistorial: tienePermiso(req, 'tickets.ver_historial'),
            encuesta: esPropio && tienePermiso(req, 'encuestas.responder') && ['Resuelto', 'Cerrado'].includes(ticket.estado)
        },
        estadosDisponibles: ESTADOS_EDITABLES
    });
});

// ===== Gestión de tickets =====

// Cambiar el estado (HU5)
router.patch('/api/tickets/:id/estado', requirePermiso('tickets.cambiar_estado'), async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const estado = limpiar(req.body.estado);
    if (!ESTADOS_EDITABLES.includes(estado)) {
        return res.status(400).json({
            error: `Estado no válido. Usa ${ESTADOS_EDITABLES.join(', ')}; para cerrar el ticket usa "Cerrar ticket".`
        });
    }
    if (ticket.estado === 'Cerrado' && !tienePermiso(req, 'tickets.cerrar')) {
        return res.status(403).json({ error: 'El ticket está cerrado y no tienes permiso para modificarlo.' });
    }
    if (ticket.estado === estado) {
        return res.status(400).json({ error: `El ticket ya está en estado ${estado}.` });
    }

    await transaccion(async (db) => {
        // Si se reabre un ticket cerrado, se limpian los datos del cierre (quedan en el historial)
        await db.query(`
            UPDATE formularios
            SET estado = $1, fecha_actualizacion = NOW(),
                fecha_cierre = NULL, cerrado_por = NULL, observacion_cierre = NULL
            WHERE id = $2
        `, [estado, ticket.id]);
        await registrarHistorial(db, ticket.id, req.usuario.id,
            ticket.estado === 'Cerrado' ? 'Reapertura' : 'Cambio de estado',
            `${ticket.estado} → ${estado}`);
    });
    res.json({ mensaje: 'Estado actualizado.', estado });
});

// Funcionarios a los que se puede asignar un ticket
router.get('/api/funcionarios', requirePermiso('tickets.asignar'), async (req, res) => {
    res.json(await buscarFuncionarios());
});

// Asignar o reasignar el responsable (HU10)
router.patch('/api/tickets/:id/asignar', requirePermiso('tickets.asignar'), async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const funcionarioId = limpiar(req.body.funcionarioId);
    if (funcionarioId === null) {
        return res.status(400).json({ error: 'Selecciona un funcionario responsable.' });
    }
    if (ticket.estado === 'Cerrado') {
        return res.status(400).json({ error: 'No se puede asignar un ticket cerrado.' });
    }
    const [funcionario] = esEnteroPositivo(funcionarioId) ? await buscarFuncionarios(Number(funcionarioId)) : [];
    if (!funcionario) {
        return res.status(400).json({ error: 'El usuario seleccionado no puede atender tickets.' });
    }
    if (ticket.funcionario_id === funcionario.id) {
        return res.status(400).json({ error: 'El ticket ya está asignado a ese funcionario.' });
    }

    const nombreNuevo = `${funcionario.nombre} ${funcionario.apellido}`;
    let detalle = `Asignado a ${nombreNuevo}`;
    if (ticket.funcionario_id) {
        const anterior = (await pool.query('SELECT nombre, apellido FROM usuarios WHERE id = $1', [ticket.funcionario_id])).rows[0];
        detalle = `Reasignado de ${anterior.nombre} ${anterior.apellido} a ${nombreNuevo}`;
    }

    await transaccion(async (db) => {
        await db.query('UPDATE formularios SET funcionario_id = $1, fecha_actualizacion = NOW() WHERE id = $2',
            [funcionario.id, ticket.id]);
        await registrarHistorial(db, ticket.id, req.usuario.id, 'Asignación', detalle);
    });
    res.json({ mensaje: 'Responsable actualizado.', responsable: nombreNuevo });
});

// Cerrar el ticket (HU13): requiere responsable asignado y observación de cierre
router.post('/api/tickets/:id/cerrar', requirePermiso('tickets.cerrar'), async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    if (ticket.estado === 'Cerrado') {
        return res.status(400).json({ error: 'El ticket ya está cerrado.' });
    }
    const observacion = limpiar(req.body.observacion);
    const faltantes = [];
    if (!observacion) faltantes.push('Observación de cierre');
    if (!ticket.funcionario_id) faltantes.push('Funcionario responsable');
    if (faltantes.length > 0) {
        return res.status(400).json({ error: `Faltan datos para cerrar el ticket: ${faltantes.join(', ')}.`, faltantes });
    }
    if (String(observacion).length > 2000) {
        return res.status(400).json({ error: 'La observación no puede superar 2000 caracteres.' });
    }

    await transaccion(async (db) => {
        await db.query(`
            UPDATE formularios
            SET estado = 'Cerrado', fecha_cierre = NOW(), cerrado_por = $1,
                observacion_cierre = $2, fecha_actualizacion = NOW()
            WHERE id = $3
        `, [req.usuario.id, observacion, ticket.id]);
        await registrarHistorial(db, ticket.id, req.usuario.id, 'Cierre', observacion);
    });
    res.json({ mensaje: 'Ticket cerrado.' });
});

// ===== Comentarios (HU11) =====

router.get('/api/tickets/:id/comentarios', requireLogin, async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const { rows } = await pool.query(`
        SELECT c.id, c.comentario, c.fecha, CONCAT_WS(' ', u.nombre, u.apellido) AS autor, r.nombre AS rol
        FROM ticket_comentarios c
        JOIN usuarios u ON u.id = c.usuario_id
        JOIN roles r ON r.id = u.rol_id
        WHERE c.formulario_id = $1
        ORDER BY c.fecha
    `, [ticket.id]);
    res.json(rows);
});

router.post('/api/tickets/:id/comentarios', requirePermiso('tickets.comentar'), async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const comentario = limpiar(String(req.body.comentario ?? ''));
    if (!comentario) {
        return res.status(400).json({ error: 'Escribe un comentario.' });
    }
    if (comentario.length > 2000) {
        return res.status(400).json({ error: 'El comentario no puede superar 2000 caracteres.' });
    }

    await transaccion(async (db) => {
        await db.query('INSERT INTO ticket_comentarios (formulario_id, usuario_id, comentario) VALUES ($1, $2, $3)',
            [ticket.id, req.usuario.id, comentario]);
        await registrarHistorial(db, ticket.id, req.usuario.id, 'Comentario',
            comentario.length > 120 ? comentario.slice(0, 117) + '...' : comentario);
    });
    res.status(201).json({ mensaje: 'Comentario agregado.' });
});

// ===== Historial (HU12) =====

router.get('/api/tickets/:id/historial', requirePermiso('tickets.ver_historial'), async (req, res) => {
    const ticket = await obtenerTicketAutorizado(req, res);
    if (!ticket) return;

    const { rows } = await pool.query(`
        SELECT h.id, h.accion, h.detalle, h.fecha, NULLIF(CONCAT_WS(' ', u.nombre, u.apellido), '') AS usuario
        FROM ticket_historial h
        LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.formulario_id = $1
        ORDER BY h.fecha DESC, h.id DESC
    `, [ticket.id]);
    res.json(rows);
});

// ===== Encuesta de satisfacción =====

router.post('/api/satisfaccion', requirePermiso('encuestas.responder'), async (req, res) => {
    const {
        serviceType, otherService, serviceDate, source, rating, satisfaction,
        speedRating, kindnessRating, clarityRating, usefulnessRating,
        improvements, recommendationScore, positiveAspects, negativeAspects,
        additionalComments, contactConsent, contactName, contactEmail, ticketId
    } = req.body;

    // La encuesta se liga al ticket evaluado, solo si es del propio usuario
    let formularioId = null;
    if (ticketId !== undefined && ticketId !== null && ticketId !== '') {
        const propio = esEnteroPositivo(ticketId)
            ? (await pool.query('SELECT id FROM formularios WHERE id = $1 AND usuario_id = $2', [ticketId, req.usuario.id])).rows[0]
            : null;
        if (!propio) {
            return res.status(400).json({ error: 'El ticket evaluado no es válido.' });
        }
        formularioId = propio.id;
    }

    try {
        await pool.query(`
            INSERT INTO encuestas_satisfaccion (
                usuario_id, tipo_servicio, otro_servicio, fecha_servicio, fuente, calificacion, satisfaccion,
                rapidez, amabilidad, claridad, utilidad, mejoras, recomienda, aspectos_positivos,
                aspectos_negativos, comentarios_adicionales, consentimiento_contacto, nombre_contacto, email_contacto,
                formulario_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        `, [
            req.usuario.id, serviceType, otherService, serviceDate, source,
            rating, satisfaction, speedRating, kindnessRating, clarityRating, usefulnessRating,
            improvements, recommendationScore, positiveAspects, negativeAspects,
            additionalComments, Boolean(contactConsent), contactName, contactEmail, formularioId
        ].map(valor => (valor === '' || valor === undefined ? null : valor))); // Campos vacíos se guardan como NULL
        res.status(201).json({ mensaje: 'Encuesta guardada con éxito.' });
    } catch (error) {
        console.error('Error al guardar la encuesta:', error);
        res.status(500).json({ error: 'Error al guardar la encuesta.' });
    }
});

module.exports = router;
