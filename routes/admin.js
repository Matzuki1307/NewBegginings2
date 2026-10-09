const express = require('express');
const bcrypt = require('bcrypt');
const { pool, transaccion } = require('../DB/db');
const { requirePermiso, tienePermiso } = require('../middleware/auth');
const { obtenerCamposRol, obtenerTarjetasRol } = require('../lib/configuracion');
const {
    limpiar, esEmail, esTelefono, esEnteroPositivo, esPasswordSegura, MENSAJE_PASSWORD, camposFaltantes
} = require('../lib/validacion');

const router = express.Router();
const gestionUsuarios = requirePermiso('usuarios.gestionar');
const gestionRoles = requirePermiso('roles.gestionar');

// =====================================================================
// Usuarios (HU1)
// =====================================================================

router.get('/api/usuarios', gestionUsuarios, async (req, res) => {
    const q = limpiar(req.query.q);
    const rolId = limpiar(req.query.rolId);
    const activo = limpiar(req.query.activo);

    const { rows } = await pool.query(`
        SELECT u.id, u.nombre, u.apellido, u.email, u.telefono, u.activo, u.fecha_registro,
               r.id AS rol_id, r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id = u.rol_id
        WHERE ($1::text IS NULL OR u.nombre ILIKE $1 OR u.apellido ILIKE $1 OR u.email ILIKE $1)
          AND ($2::int IS NULL OR u.rol_id = $2)
          AND ($3::boolean IS NULL OR u.activo = $3)
        ORDER BY u.fecha_registro DESC
        LIMIT 500
    `, [
        q && '%' + q.replace(/[\\%_]/g, '\\$&') + '%',
        esEnteroPositivo(rolId) ? Number(rolId) : null,
        activo === 'true' ? true : activo === 'false' ? false : null
    ]);
    res.json(rows);
});

// Valida los datos de un usuario. La contraseña es obligatoria solo al crear.
async function validarUsuario(body, esNuevo) {
    const datos = {
        nombre: limpiar(body.nombre),
        apellido: limpiar(body.apellido),
        email: limpiar(body.email),
        telefono: limpiar(body.telefono),
        rolId: limpiar(body.rolId),
        password: body.password || null
    };

    const obligatorios = { nombre: 'Nombre', apellido: 'Apellido', email: 'Correo electrónico', rolId: 'Rol' };
    if (esNuevo) obligatorios.password = 'Contraseña';
    const faltantes = camposFaltantes(datos, obligatorios);
    if (faltantes.length > 0) {
        return { error: `Faltan datos obligatorios: ${faltantes.join(', ')}.`, faltantes };
    }

    if (String(datos.nombre).length > 100 || String(datos.apellido).length > 100) {
        return { error: 'El nombre y el apellido no pueden superar 100 caracteres.' };
    }
    if (!esEmail(datos.email)) {
        return { error: 'El correo electrónico no es válido.' };
    }
    if (datos.telefono !== null && !esTelefono(datos.telefono)) {
        return { error: 'El teléfono solo puede tener números (7 a 15 dígitos).' };
    }
    if (datos.password !== null && !esPasswordSegura(datos.password)) {
        return { error: MENSAJE_PASSWORD };
    }
    const rol = esEnteroPositivo(datos.rolId)
        ? (await pool.query('SELECT id, es_admin FROM roles WHERE id = $1', [datos.rolId])).rows[0]
        : null;
    if (!rol) {
        return { error: 'El rol seleccionado no existe.' };
    }
    datos.rolId = rol.id;
    datos.rolEsAdmin = rol.es_admin;
    return { datos };
}

router.post('/api/usuarios', gestionUsuarios, async (req, res) => {
    const { datos, ...error } = await validarUsuario(req.body, true);
    if (!datos) return res.status(400).json(error);

    // Solo un administrador puede crear otras cuentas de administrador (evita la escalada de privilegios)
    if (datos.rolEsAdmin && !req.usuario.es_admin) {
        return res.status(403).json({ error: 'Solo un administrador puede crear cuentas de administrador.' });
    }

    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [datos.email]);
    if (existe.rows.length > 0) {
        return res.status(409).json({ error: 'El correo ya está registrado.' });
    }

    const hash = await bcrypt.hash(datos.password, 10);
    const { rows } = await pool.query(`
        INSERT INTO usuarios (nombre, apellido, email, telefono, password, rol_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [datos.nombre, datos.apellido, datos.email, datos.telefono, hash, datos.rolId]);
    res.status(201).json({ mensaje: 'Usuario creado.', id: rows[0].id });
});

router.put('/api/usuarios/:id', gestionUsuarios, async (req, res) => {
    const usuario = esEnteroPositivo(req.params.id)
        ? (await pool.query(`SELECT u.id, u.rol_id, r.es_admin
                             FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1`, [req.params.id])).rows[0]
        : null;
    if (!usuario) return res.status(404).json({ error: 'El usuario no existe.' });

    // Una cuenta de administrador solo la puede editar otro administrador (evita el secuestro de la cuenta)
    if (usuario.es_admin && !req.usuario.es_admin) {
        return res.status(403).json({ error: 'Solo un administrador puede editar cuentas de administrador.' });
    }

    const { datos, ...error } = await validarUsuario(req.body, false);
    if (!datos) return res.status(400).json(error);

    // Solo un administrador puede otorgar el rol de administrador
    if (datos.rolEsAdmin && !req.usuario.es_admin) {
        return res.status(403).json({ error: 'Solo un administrador puede asignar el rol de administrador.' });
    }

    if (usuario.id === req.usuario.id && datos.rolId !== usuario.rol_id) {
        return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
    }
    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) AND id <> $2',
        [datos.email, usuario.id]);
    if (existe.rows.length > 0) {
        return res.status(409).json({ error: 'El correo ya está registrado por otro usuario.' });
    }

    // La contraseña solo cambia si se envía una nueva
    const hash = datos.password ? await bcrypt.hash(datos.password, 10) : null;
    await pool.query(`
        UPDATE usuarios
        SET nombre = $1, apellido = $2, email = $3, telefono = $4, rol_id = $5,
            password = COALESCE($6, password)
        WHERE id = $7
    `, [datos.nombre, datos.apellido, datos.email, datos.telefono, datos.rolId, hash, usuario.id]);
    res.json({ mensaje: 'Usuario actualizado.' });
});

// Activar o desactivar (un usuario desactivado no puede iniciar sesión)
router.patch('/api/usuarios/:id/activo', gestionUsuarios, async (req, res) => {
    if (typeof req.body.activo !== 'boolean') {
        return res.status(400).json({ error: 'Indica si el usuario queda activo o inactivo.' });
    }
    if (Number(req.params.id) === req.usuario.id) {
        return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    }

    const objetivo = esEnteroPositivo(req.params.id)
        ? (await pool.query(`SELECT r.es_admin FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1`, [req.params.id])).rows[0]
        : null;
    if (!objetivo) return res.status(404).json({ error: 'El usuario no existe.' });

    // Solo un administrador puede activar o desactivar a otro administrador
    if (objetivo.es_admin && !req.usuario.es_admin) {
        return res.status(403).json({ error: 'Solo un administrador puede activar o desactivar cuentas de administrador.' });
    }

    const { rowCount } = await pool.query('UPDATE usuarios SET activo = $1 WHERE id = $2', [req.body.activo, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'El usuario no existe.' });

    res.json({ mensaje: req.body.activo ? 'Usuario activado.' : 'Usuario desactivado.' });
});

// =====================================================================
// Roles (HU6)
// =====================================================================

// Lo usan tanto la gestión de usuarios (para elegir rol) como la de roles
function gestionUsuariosORoles(req, res, next) {
    if (tienePermiso(req, 'usuarios.gestionar')) return next();
    return gestionRoles(req, res, next);
}

router.get('/api/roles', gestionUsuariosORoles, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT r.id, r.nombre, r.descripcion, r.es_sistema, r.es_admin, r.es_registro,
               (SELECT COUNT(*)::int FROM usuarios u WHERE u.rol_id = r.id) AS usuarios
        FROM roles r
        ORDER BY r.id
    `);
    res.json(rows);
});

async function obtenerRol(req, res) {
    const rol = esEnteroPositivo(req.params.id)
        ? (await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id])).rows[0]
        : null;
    if (!rol) res.status(404).json({ error: 'El rol no existe.' });
    return rol;
}

function validarRol(body) {
    const nombre = limpiar(body.nombre);
    const descripcion = limpiar(body.descripcion);
    if (!nombre) {
        return { error: 'Faltan datos obligatorios: Nombre del rol.', faltantes: ['Nombre del rol'] };
    }
    if (String(nombre).length > 50) return { error: 'El nombre del rol no puede superar 50 caracteres.' };
    if (descripcion && String(descripcion).length > 255) return { error: 'La descripción no puede superar 255 caracteres.' };
    return { datos: { nombre: String(nombre), descripcion } };
}

router.post('/api/roles', gestionRoles, async (req, res) => {
    const { datos, ...error } = validarRol(req.body);
    if (!datos) return res.status(400).json(error);

    const existe = await pool.query('SELECT id FROM roles WHERE LOWER(nombre) = LOWER($1)', [datos.nombre]);
    if (existe.rows.length > 0) {
        return res.status(409).json({ error: 'Ya existe un rol con ese nombre.' });
    }
    const { rows } = await pool.query('INSERT INTO roles (nombre, descripcion) VALUES ($1, $2) RETURNING id',
        [datos.nombre, datos.descripcion]);
    res.status(201).json({ mensaje: 'Rol creado.', id: rows[0].id });
});

router.put('/api/roles/:id', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;
    const { datos, ...error } = validarRol(req.body);
    if (!datos) return res.status(400).json(error);

    if (rol.es_sistema && datos.nombre !== rol.nombre) {
        return res.status(400).json({ error: 'Los roles del sistema no se pueden renombrar.' });
    }
    const existe = await pool.query('SELECT id FROM roles WHERE LOWER(nombre) = LOWER($1) AND id <> $2',
        [datos.nombre, rol.id]);
    if (existe.rows.length > 0) {
        return res.status(409).json({ error: 'Ya existe un rol con ese nombre.' });
    }
    await pool.query('UPDATE roles SET nombre = $1, descripcion = $2 WHERE id = $3',
        [datos.nombre, datos.descripcion, rol.id]);
    res.json({ mensaje: 'Rol actualizado.' });
});

router.delete('/api/roles/:id', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;
    if (rol.es_sistema) {
        return res.status(400).json({ error: 'Los roles del sistema no se pueden eliminar.' });
    }
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios WHERE rol_id = $1', [rol.id]);
    if (rows[0].total > 0) {
        return res.status(409).json({
            error: `El rol tiene ${rows[0].total} usuario(s) asignado(s). Cámbialos de rol antes de eliminarlo.`
        });
    }
    await pool.query('DELETE FROM roles WHERE id = $1', [rol.id]);
    res.json({ mensaje: 'Rol eliminado.' });
});

// =====================================================================
// Permisos, tarjetas y campos por rol (HU7, HU8, HU9)
// =====================================================================

router.get('/api/roles/:id/configuracion', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;

    const [permisos, asignados, tarjetas, campos] = await Promise.all([
        pool.query('SELECT codigo, nombre, descripcion, modulo FROM permisos ORDER BY orden'),
        pool.query(`SELECT p.codigo FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                    WHERE rp.rol_id = $1`, [rol.id]),
        obtenerTarjetasRol(rol.id, rol.es_admin),
        obtenerCamposRol(rol.id)
    ]);
    const codigosAsignados = new Set(asignados.rows.map(p => p.codigo));

    res.json({
        rol,
        permisos: permisos.rows.map(p => ({ ...p, activo: rol.es_admin || codigosAsignados.has(p.codigo) })),
        tarjetas: tarjetas.map(({ codigo, nombre, descripcion, ruta, visible }) => ({ codigo, nombre, descripcion, ruta, visible })),
        campos: campos.map(({ codigo, etiqueta, visible, habilitado, obligatorio }) => ({ codigo, etiqueta, visible, habilitado, obligatorio }))
    });
});

router.put('/api/roles/:id/permisos', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;
    if (rol.es_admin) {
        return res.status(400).json({ error: 'El rol administrador siempre tiene todos los permisos.' });
    }
    const { permisos } = req.body;
    if (!Array.isArray(permisos) || !permisos.every(p => typeof p === 'string')) {
        return res.status(400).json({ error: 'La lista de permisos no es válida.' });
    }
    const validos = await pool.query('SELECT codigo FROM permisos WHERE codigo = ANY($1)', [permisos]);
    const desconocidos = permisos.filter(p => !validos.rows.some(v => v.codigo === p));
    if (desconocidos.length > 0) {
        return res.status(400).json({ error: `Permiso no válido: ${desconocidos.join(', ')}.` });
    }

    await transaccion(async (db) => {
        await db.query('DELETE FROM roles_permisos WHERE rol_id = $1', [rol.id]);
        await db.query(`INSERT INTO roles_permisos (rol_id, permiso_id)
                        SELECT $1, id FROM permisos WHERE codigo = ANY($2)`, [rol.id, permisos]);
    });
    res.json({ mensaje: 'Permisos guardados.' });
});

router.put('/api/roles/:id/tarjetas', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;
    const { tarjetas } = req.body;
    if (!Array.isArray(tarjetas) || !tarjetas.every(t => t && typeof t.codigo === 'string' && typeof t.visible === 'boolean')) {
        return res.status(400).json({ error: 'La configuración de tarjetas no es válida.' });
    }

    await transaccion(async (db) => {
        for (const tarjeta of tarjetas) {
            const { rowCount } = await db.query(`
                INSERT INTO roles_tarjetas (rol_id, tarjeta_id, visible)
                SELECT $1, id, $3 FROM tarjetas WHERE codigo = $2
                ON CONFLICT (rol_id, tarjeta_id) DO UPDATE SET visible = EXCLUDED.visible
            `, [rol.id, tarjeta.codigo, tarjeta.visible]);
            if (rowCount === 0) throw Object.assign(new Error(), { estado: 400, mensaje: `Tarjeta no válida: ${tarjeta.codigo}.` });
        }
    }).then(
        () => res.json({ mensaje: 'Tarjetas guardadas.' }),
        (error) => {
            if (error.estado) return res.status(error.estado).json({ error: error.mensaje });
            throw error;
        });
});

router.put('/api/roles/:id/campos', gestionRoles, async (req, res) => {
    const rol = await obtenerRol(req, res);
    if (!rol) return;
    const { campos } = req.body;
    const esBool = v => typeof v === 'boolean';
    if (!Array.isArray(campos) || !campos.every(c => c && typeof c.codigo === 'string'
            && esBool(c.visible) && esBool(c.habilitado) && esBool(c.obligatorio))) {
        return res.status(400).json({ error: 'La configuración de campos no es válida.' });
    }

    await transaccion(async (db) => {
        for (const campo of campos) {
            // Un campo oculto no puede modificarse, y uno que no se puede modificar no puede ser obligatorio
            const visible = campo.visible;
            const habilitado = visible && campo.habilitado;
            const obligatorio = habilitado && campo.obligatorio;
            const { rowCount } = await db.query(`
                INSERT INTO roles_campos (rol_id, campo_id, visible, habilitado, obligatorio)
                SELECT $1, id, $3, $4, $5 FROM campos_formulario WHERE codigo = $2
                ON CONFLICT (rol_id, campo_id) DO UPDATE
                SET visible = EXCLUDED.visible, habilitado = EXCLUDED.habilitado, obligatorio = EXCLUDED.obligatorio
            `, [rol.id, campo.codigo, visible, habilitado, obligatorio]);
            if (rowCount === 0) throw Object.assign(new Error(), { estado: 400, mensaje: `Campo no válido: ${campo.codigo}.` });
        }
    }).then(
        () => res.json({ mensaje: 'Campos guardados.' }),
        (error) => {
            if (error.estado) return res.status(error.estado).json({ error: error.mensaje });
            throw error;
        });
});

module.exports = router;
