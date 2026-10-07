const path = require('path');
const { pool } = require('../DB/db');

// Carga en cada petición el usuario de la sesión con su rol y permisos.
// Se consulta siempre la base de datos para que un cambio de permisos o una
// desactivación se apliquen de inmediato (HU2, HU7).
async function cargarUsuario(req, res, next) {
    req.usuario = null;
    if (!req.session.userId) return next();

    try {
        const { rows } = await pool.query(`
            SELECT u.id, u.nombre, u.apellido, u.email, u.activo,
                   r.id AS rol_id, r.nombre AS rol, r.es_admin,
                   CASE WHEN r.es_admin THEN ARRAY(SELECT codigo FROM permisos)
                        ELSE ARRAY(SELECT p.codigo FROM roles_permisos rp
                                   JOIN permisos p ON p.id = rp.permiso_id
                                   WHERE rp.rol_id = r.id)
                   END AS permisos
            FROM usuarios u
            JOIN roles r ON r.id = u.rol_id
            WHERE u.id = $1
        `, [req.session.userId]);

        const usuario = rows[0];
        if (!usuario || !usuario.activo) {
            // Usuario eliminado o desactivado: se cierra su sesión
            delete req.session.userId;
            return next();
        }

        req.usuario = { ...usuario, permisos: new Set(usuario.permisos) };
        next();
    } catch (error) {
        next(error);
    }
}

function tienePermiso(req, codigo) {
    return Boolean(req.usuario && req.usuario.permisos.has(codigo));
}

// ----- Protección de la API (responde JSON) -----

function requireLogin(req, res, next) {
    if (!req.usuario) {
        return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }
    next();
}

function requirePermiso(codigo) {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
        }
        if (!tienePermiso(req, codigo)) {
            return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
        }
        next();
    };
}

// ----- Protección de páginas (redirige o muestra la página 403) -----

// Manda al login y luego regresa a la página pedida
function requirePageLogin(req, res, next) {
    if (!req.usuario) {
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
    }
    next();
}

function requirePagePermiso(codigo) {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
        }
        if (!tienePermiso(req, codigo)) {
            return res.status(403).sendFile(path.join(__dirname, '..', 'template', '403.html'));
        }
        next();
    };
}

// Solo permite redirigir a rutas internas (evita redirecciones a otros sitios)
function rutaSegura(destino) {
    return typeof destino === 'string' && /^\/(?![\/\\])/.test(destino) ? destino : '/panel';
}

module.exports = {
    cargarUsuario,
    tienePermiso,
    requireLogin,
    requirePermiso,
    requirePageLogin,
    requirePagePermiso,
    rutaSegura
};
