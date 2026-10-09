require('dotenv').config(); // Carga las variables de entorno desde .env
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool, initDb } = require('./DB/db'); // Conexión a PostgreSQL
const {
    cargarUsuario, requirePageLogin, requirePagePermiso, rutaSegura
} = require('./middleware/auth');

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
        sameSite: 'lax', // La cookie no viaja en peticiones desde otros sitios (mitiga CSRF)
        maxAge: 1000 * 60 * 60 * 24 // 1 día
    }
}));

// Rol y permisos del usuario logueado en req.usuario
app.use(cargarUsuario);

// Ruta para comprobar que la app y la base de datos responden
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (error) {
        res.status(503).json({ status: 'error' });
    }
});

// ===== Páginas =====

function pagina(archivo) {
    return (req, res) => res.sendFile(path.join(__dirname, 'template', archivo));
}

// Ruta principal
app.get('/', pagina('index.html'));

// Si ya hay sesión, el login y el registro llevan directo al destino
app.get(['/login', '/registro'], (req, res, next) => {
    if (req.usuario) {
        return res.redirect(rutaSegura(req.query.redirect));
    }
    next();
});
app.get('/login', pagina('login.html'));
app.get('/registro', pagina('registro.html'));

app.get('/panel', requirePageLogin, pagina('panel.html'));

// Usuarios
app.get('/formulario', requirePagePermiso('tickets.crear'), pagina('formulario.html'));
app.get('/ticket', requirePagePermiso('tickets.crear'), pagina('ticket.html'));
app.get('/validar', requirePagePermiso('tickets.ver_propios'), pagina('validar.html'));
app.get('/satisfaccion', requirePagePermiso('encuestas.responder'), pagina('satisfaccion.html'));

// Detalle de un ticket (la API decide qué puede ver y hacer cada usuario)
app.get('/tickets/:id', requirePageLogin, pagina('ticket-detalle.html'));

// Funcionarios
app.get('/gestion', requirePagePermiso('tickets.ver_todos'), pagina('gestion.html'));
app.get('/beneficiarios', requirePagePermiso('beneficiarios.consultar'), pagina('beneficiarios.html'));

// Administración
app.get('/estadisticas', requirePagePermiso('estadisticas.ver'), pagina('estadisticas.html'));
app.get('/modelado', requirePagePermiso('modelado.ver'), pagina('modelado.html'));
app.get('/admin/usuarios', requirePagePermiso('usuarios.gestionar'), pagina('admin-usuarios.html'));
app.get('/admin/roles', requirePagePermiso('roles.gestionar'), pagina('admin-roles.html'));

// ===== API =====

app.use(require('./routes/auth'));
app.use(require('./routes/catalogos'));
app.use(require('./routes/tickets'));
app.use(require('./routes/reportes'));
app.use(require('./routes/modelado'));
app.use(require('./routes/admin'));

// Errores no controlados en las rutas
app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Los datos enviados no tienen un formato válido.' });
    }
    console.error(`Error en ${req.method} ${req.originalUrl}:`, error);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
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
