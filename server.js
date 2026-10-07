require('dotenv').config(); // Carga las variables de entorno desde .env
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool, initDb } = require('./DB/db'); // Conexión a PostgreSQL

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
    console.error('Falta la variable de entorno SESSION_SECRET.');
    process.exit(1);
}

// En producción (Render) la app está detrás de un proxy con HTTPS
if (isProduction) {
    app.set('trust proxy', 1);
}

// Middleware para servir archivos estáticos
app.use(express.static('public'));

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Las sesiones se guardan en Postgres para que sobrevivan a los reinicios
app.use(session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction, // Solo por HTTPS en producción
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 día
    }
}));

// Middleware para proteger rutas de la API
function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }
    next();
}

// Middleware para proteger páginas: manda al login y luego regresa a la página pedida
function requirePageLogin(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
    }
    next();
}

// Solo permite redirigir a rutas internas (evita redirecciones a otros sitios)
function rutaSegura(destino) {
    return typeof destino === 'string' && /^\/(?![\/\\])/.test(destino) ? destino : '/formulario';
}

// Ruta para comprobar que la app y la base de datos responden
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (error) {
        res.status(503).json({ status: 'error' });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/template/index.html');
});

// Ruta para el formulario
app.get('/formulario', requirePageLogin, (req, res) => {
    res.sendFile(__dirname + '/template/formulario.html');
});

// Si ya hay sesión, el login y el registro llevan directo al destino
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect(rutaSegura(req.query.redirect));
    }
    res.sendFile(__dirname + '/template/login.html');
});

app.get('/registro', (req, res) => {
    if (req.session.userId) {
        return res.redirect(rutaSegura(req.query.redirect));
    }
    res.sendFile(__dirname + '/template/registro.html');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/ticket', requirePageLogin, (req, res) => {
    res.sendFile(__dirname + '/template/ticket.html');
});

app.get('/validar', requirePageLogin, (req, res) => {
    res.sendFile(__dirname + '/template/validar.html');
});

app.get('/satisfaccion', requirePageLogin, (req, res) => {
    res.sendFile(__dirname + '/template/satisfaccion.html');
});

// Ruta para manejar el formulario
app.post('/api/formulario', requireLogin, async (req, res) => {
    const { nombre, tipoId, numeroId, genero, telefono, situacionId, departamento, unidadMedida, cantidad } = req.body;
    const idUsuario = req.session.userId; // Toma el id del usuario logueado

    if (!nombre || !tipoId || !numeroId || !genero || !telefono || !situacionId || !departamento) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        const result = await pool.query(`
            INSERT INTO formularios (nombre, tipo_identificacion_id, numero_identificacion, genero_id, telefono,
                                     situacion_id, departamento_id, unidad_medida_id, cantidad, usuario_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id AS "Id", fecha_creacion AS "FechaCreacion", estado AS "Estado"
        `, [nombre, tipoId, numeroId, genero, telefono, situacionId, departamento,
            unidadMedida || null, cantidad || null, idUsuario]);

        req.session.ticket = result.rows[0];

        res.status(200).send('Formulario enviado con éxito.');
    } catch (error) {
        console.error('Error al insertar en la base de datos:', error);
        res.status(500).send('Error al procesar el formulario.');
    }
});

// Ruta para obtener los géneros
app.get('/api/generos', async (req, res) => {
    try {
        const result = await pool.query('SELECT id AS "Id", descripcion AS "Descripcion" FROM generos ORDER BY id');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener los géneros:', error);
        res.status(500).send('Error al obtener los géneros.');
    }
});

// Ruta para obtener los tipos de identificación
app.get('/api/tipos-id', async (req, res) => {
    try {
        const result = await pool.query('SELECT id AS "Id", descripcion AS "Descripcion" FROM tipos_identificacion ORDER BY id');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener los tipos de identificación:', error);
        res.status(500).send('Error al obtener los tipos de identificación.');
    }
});

// Ruta para obtener las situaciones
app.get('/api/situaciones', async (req, res) => {
    try {
        const result = await pool.query('SELECT id AS "Id", situacion AS "Situacion" FROM situaciones ORDER BY id');
        res.status(200).json(result.rows); // Devuelve las situaciones como JSON
    } catch (error) {
        console.error('Error al obtener las situaciones:', error);
        res.status(500).send('Error al obtener las situaciones.');
    }
});

// Ruta para obtener los departamentos
app.get('/api/departamentos', async (req, res) => {
    try {
        const result = await pool.query('SELECT id AS "Id", nombre AS "Descripcion" FROM departamentos ORDER BY nombre');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener los departamentos:', error);
        res.status(500).send('Error al obtener los departamentos.');
    }
});

// Ruta para obtener las unidades de medida
app.get('/api/unidades-medida', async (req, res) => {
    try {
        const result = await pool.query('SELECT id AS "Id", nombre AS "Descripcion" FROM unidades_medida ORDER BY nombre');
        res.status(200).json(result.rows); // Devuelve las unidades de medida como JSON
    } catch (error) {
        console.error('Error al obtener las unidades de medida:', error);
        res.status(500).send('Error al obtener las unidades de medida.');
    }
});

// Ruta para registrar usuario
app.post('/api/registro', async (req, res) => {
    const { nombre, apellido, email, telefono, password } = req.body;

    // Validación básica
    if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos requeridos.' });
    }

    try {
        // Verifica si el usuario ya existe
        const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        // Encripta la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Inserta el usuario
        await pool.query(`
            INSERT INTO usuarios (nombre, apellido, email, telefono, password)
            VALUES ($1, $2, $3, $4, $5)
        `, [nombre, apellido, email, telefono || null, hashedPassword]);

        res.status(201).json({ mensaje: 'Usuario registrado con éxito.' });
    } catch (error) {
        console.error('Error en el registro:', error);
        res.status(500).json({ error: 'Error al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    // Validación básica
    if (!email || !password) {
        return res.status(400).json({ error: 'Correo y contraseña requeridos.' });
    }

    try {
        // Busca el usuario por email
        const result = await pool.query('SELECT id, password FROM usuarios WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const usuario = result.rows[0];

        // Compara la contraseña ingresada con el hash almacenado
        const passwordValida = await bcrypt.compare(password, usuario.password);

        if (!passwordValida) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        req.session.userId = usuario.id; // Guarda el ID del usuario en la sesión
        res.status(200).json({ mensaje: 'Login exitoso.' });
    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

// Ruta para obtener el ticket
app.get('/api/ticket', requireLogin, (req, res) => {
    if (!req.session.ticket) {
        return res.status(404).json({ error: 'No hay ticket reciente.' });
    }
    res.json(req.session.ticket);
});

// Ruta para obtener los tickets del usuario logueado
app.get('/api/mis-tickets', requireLogin, async (req, res) => {
    try {
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
            INNER JOIN situaciones s ON f.situacion_id = s.id
            WHERE f.usuario_id = $1
            ORDER BY f.fecha_creacion DESC
        `, [req.session.userId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener los tickets:', error);
        res.status(500).json({ error: 'Error al obtener los tickets.' });
    }
});

// Ruta para obtener el nombre del usuario logueado
app.get('/api/usuario', requireLogin, async (req, res) => {
    try {
        const result = await pool.query('SELECT nombre FROM usuarios WHERE id = $1', [req.session.userId]);
        if (result.rows.length > 0) {
            res.json({ nombre: result.rows[0].nombre });
        } else {
            res.json({ nombre: 'Usuario' });
        }
    } catch (error) {
        res.json({ nombre: 'Usuario' });
    }
});

// Ruta para enviar encuesta de satisfacción
app.post('/api/satisfaccion', requireLogin, async (req, res) => {
    const {
        serviceType, otherService, serviceDate, source, rating, satisfaction,
        speedRating, kindnessRating, clarityRating, usefulnessRating,
        improvements, recommendationScore, positiveAspects, negativeAspects,
        additionalComments, contactConsent, contactName, contactEmail
    } = req.body;

    try {
        await pool.query(`
            INSERT INTO encuestas_satisfaccion (
                usuario_id, tipo_servicio, otro_servicio, fecha_servicio, fuente, calificacion, satisfaccion,
                rapidez, amabilidad, claridad, utilidad, mejoras, recomienda, aspectos_positivos,
                aspectos_negativos, comentarios_adicionales, consentimiento_contacto, nombre_contacto, email_contacto
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
            req.session.userId, serviceType, otherService, serviceDate, source,
            rating, satisfaction, speedRating, kindnessRating, clarityRating, usefulnessRating,
            improvements, recommendationScore, positiveAspects, negativeAspects,
            additionalComments, Boolean(contactConsent), contactName, contactEmail
        ].map(valor => (valor === '' || valor === undefined ? null : valor))); // Campos vacíos se guardan como NULL
        res.status(201).json({ mensaje: 'Encuesta guardada con éxito.' });
    } catch (error) {
        console.error('Error al guardar la encuesta:', error);
        res.status(500).json({ error: 'Error al guardar la encuesta.' });
    }
});

// Prepara la base de datos y luego inicia el servidor
initDb()
    .then(() => {
        app.listen(port, () => {
            console.log(`Servidor corriendo en http://localhost:${port}`);
        });
    })
    .catch((error) => {
        console.error('No se pudo inicializar la base de datos:', error);
        process.exit(1);
    });
