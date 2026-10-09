const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { pool } = require('../DB/db');
const { requireLogin } = require('../middleware/auth');
const { obtenerTarjetasRol } = require('../lib/configuracion');
const { limpiar, esEmail, esTelefono, esPasswordSegura, MENSAJE_PASSWORD } = require('../lib/validacion');

const router = express.Router();

// Freno a la fuerza bruta: limita los intentos por IP en login y registro.
// Los intentos exitosos no cuentan, para no castigar al usuario legítimo.
const limiteLogin = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});

const limiteRegistro = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados registros desde esta red. Inténtalo más tarde.' }
});

// Ruta para registrar usuario (siempre recibe el rol de registro)
router.post('/api/registro', limiteRegistro, async (req, res) => {
    const nombre = limpiar(req.body.nombre);
    const apellido = limpiar(req.body.apellido);
    const email = limpiar(req.body.email);
    const telefono = limpiar(req.body.telefono);
    const { password } = req.body;

    // Validación básica
    if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos requeridos.' });
    }
    if (!esEmail(email)) {
        return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }
    if (telefono && !esTelefono(telefono)) {
        return res.status(400).json({ error: 'El teléfono solo puede tener números (7 a 15 dígitos).' });
    }
    if (!esPasswordSegura(password)) {
        return res.status(400).json({ error: MENSAJE_PASSWORD });
    }

    try {
        // Verifica si el usuario ya existe
        const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        // Encripta la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Inserta el usuario con el rol de registro
        await pool.query(`
            INSERT INTO usuarios (nombre, apellido, email, telefono, password, rol_id)
            VALUES ($1, $2, $3, $4, $5, (SELECT id FROM roles WHERE es_registro ORDER BY id LIMIT 1))
        `, [nombre, apellido, email, telefono, hashedPassword]);

        res.status(201).json({ mensaje: 'Usuario registrado con éxito.' });
    } catch (error) {
        console.error('Error en el registro:', error);
        res.status(500).json({ error: 'Error al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión
router.post('/api/login', limiteLogin, async (req, res) => {
    const { email, password } = req.body;

    // Validación básica
    if (!email || !password) {
        return res.status(400).json({ error: 'Correo y contraseña requeridos.' });
    }

    try {
        // Busca el usuario por email
        const result = await pool.query(
            'SELECT id, password, activo FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const usuario = result.rows[0];

        // Compara la contraseña ingresada con el hash almacenado
        const passwordValida = await bcrypt.compare(password, usuario.password);

        if (!passwordValida) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        if (!usuario.activo) {
            return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });
        }

        req.session.userId = usuario.id; // Guarda el ID del usuario en la sesión
        res.status(200).json({ mensaje: 'Login exitoso.' });
    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// Datos del usuario logueado: rol, permisos y tarjetas visibles en el panel (HU8)
router.get('/api/me', requireLogin, async (req, res) => {
    const tarjetas = await obtenerTarjetasRol(req.usuario.rol_id, req.usuario.es_admin);

    res.json({
        id: req.usuario.id,
        nombre: req.usuario.nombre,
        apellido: req.usuario.apellido,
        email: req.usuario.email,
        rol: req.usuario.rol,
        permisos: [...req.usuario.permisos],
        // Una tarjeta visible solo se muestra si además se tiene el permiso de su funcionalidad
        tarjetas: tarjetas
            .filter(t => t.visible && req.usuario.permisos.has(t.permiso_codigo))
            .map(({ codigo, nombre, descripcion, ruta }) => ({ codigo, nombre, descripcion, ruta }))
    });
});

// Ruta para obtener el nombre del usuario logueado
router.get('/api/usuario', requireLogin, (req, res) => {
    res.json({ nombre: req.usuario.nombre });
});

module.exports = router;
