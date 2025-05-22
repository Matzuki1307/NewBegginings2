const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const Config = require('./DB/db'); // Importa la configuración de la base de datos
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const port = 3000;

// Middleware para servir archivos estáticos
app.use(express.static('public'));
//app.use(express.static('template'));

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'tu_secreto_seguro',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Usa true si tienes HTTPS
}));

// Middleware para proteger rutas
function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }
    next();
}

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/template/index.html');
});

// Ruta para el formulario
app.get('/formulario', requireLogin, (req, res) => {
    res.sendFile(__dirname + '/template/formulario.html');
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/template/login.html');
});

app.get('/registro', (req, res) => {
    res.sendFile(__dirname + '/template/registro.html');
});

app.get('/ticket',requireLogin, (req, res) => {
    res.sendFile(__dirname + '/template/ticket.html');
});

app.get('/validar',requireLogin, (req, res) => {
    res.sendFile(__dirname + '/template/validar.html');
});

app.get('/satisfaccion',requireLogin, (req, res) => {
    res.sendFile(__dirname + '/template/satisfaccion.html');
});

// Ruta para manejar el formulario
app.post('/api/formulario', requireLogin, async (req, res) => {
    const { nombre, tipoId, numeroId, genero, telefono, situacionId, departamento, unidadMedida, cantidad } = req.body;
    const idUsuario = req.session.userId; // <-- Toma el id del usuario logueado

    if (!nombre || !tipoId || !numeroId || !genero || !telefono || !situacionId || !departamento) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        const pool = await sql.connect(Config);
        const result = await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .input('tipoId', sql.Int, tipoId)
            .input('numeroId', sql.NVarChar, numeroId)
            .input('genero', sql.Int, genero)
            .input('telefono', sql.NVarChar, telefono)
            .input('situacionId', sql.Int, situacionId)
            .input('departamento', sql.Int, departamento)
            .input('unidadMedida', sql.Int, unidadMedida || null)
            .input('cantidad', sql.Int, cantidad || null)
            .input('idUsuario', sql.Int, idUsuario) // <-- Aquí agregas el id del usuario
            .query(`
                INSERT INTO Formulario (Nombre, TipoId, NumeroId, Genero, Telefono, SituacionId, DepartamentoID, UnidadMedida, Cantidad, Estado, FechaCreacion, IdUsuario)
                OUTPUT INSERTED.Id, INSERTED.FechaCreacion, INSERTED.Estado
                VALUES (@nombre, @tipoId, @numeroId, @genero, @telefono, @situacionId, @departamento, @unidadMedida, @cantidad, 'Pendiente', GETDATE(), @idUsuario)
            `);

        req.session.ticket = {
            Id: result.recordset[0].Id,
            FechaCreacion: result.recordset[0].FechaCreacion,
            Estado: result.recordset[0].Estado
        };

        res.status(200).send('Formulario enviado con éxito.');
    } catch (error) {
        console.error('Error al insertar en la base de datos:', error);
        res.status(500).send('Error al procesar el formulario.');
    }
});

// Ruta para obtener los géneros
app.get('/api/generos', async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT Id, Descripcion FROM Genero ORDER BY Id');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error al obtener los géneros:', error);
        res.status(500).send('Error al obtener los géneros.');
    }
});

// Ruta para obtener los tipos de identificación
app.get('/api/tipos-id', async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT Id, Descripcion FROM TipoId ORDER BY Id');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error al obtener los tipos de identificación:', error);
        res.status(500).send('Error al obtener los tipos de identificación.');
    }
});

// Ruta para obtener las situaciones
app.get('/api/situaciones', async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT Id, Situacion FROM Situacion ORDER BY Id');
        res.status(200).json(result.recordset); // Devuelve las situaciones como JSON
    } catch (error) {
        console.error('Error al obtener las situaciones:', error);
        res.status(500).send('Error al obtener las situaciones.');
    }
});

// Ruta para obtener los departamentos
app.get('/api/departamentos', async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT Id, Nombre AS Descripcion FROM Departamentos ORDER BY Nombre');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error al obtener los departamentos:', error);
        res.status(500).send('Error al obtener los departamentos.');
    }
});

// Ruta para obtener las unidades de medida
app.get('/api/unidades-medida', async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT Id, Nombre AS Descripcion FROM UnidadesMedida ORDER BY Nombre');
        res.status(200).json(result.recordset); // Devuelve las unidades de medida como JSON
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
        const pool = await sql.connect(Config);

        // Verifica si el usuario ya existe
        const existe = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT Id FROM Usuarios WHERE Email = @email');
        if (existe.recordset.length > 0) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        // Encripta la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Inserta el usuario
        await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .input('apellido', sql.NVarChar, apellido)
            .input('email', sql.NVarChar, email)
            .input('telefono', sql.NVarChar, telefono || null)
            .input('password', sql.NVarChar, hashedPassword)
            .query(`
                INSERT INTO Usuarios (Nombre, Apellido, Email, Telefono, Password)
                VALUES (@nombre, @apellido, @email, @telefono, @password)
            `);

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
        const pool = await sql.connect(Config);
        // Busca el usuario por email
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT Id, Password FROM Usuarios WHERE Email = @email');

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const usuario = result.recordset[0];

        // Compara la contraseña ingresada con el hash almacenado
        const passwordValida = await bcrypt.compare(password, usuario.Password);

        if (!passwordValida) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        // Si todo está bien, puedes devolver info básica o un token si lo implementas
        req.session.userId = usuario.Id; // Guarda el ID del usuario en la sesión
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

// Nueva ruta para obtener los tickets de un usuario
app.get('/api/mis-tickets', requireLogin, async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request()
            .input('usuarioId', sql.Int, req.session.userId)
            .query(`
                SELECT 
                    f.Id, 
                    f.Nombre, 
                    u.Email,
                    s.Situacion AS Situacion,
                    f.Estado, 
                    f.FechaCreacion
                FROM Formulario f
                INNER JOIN Usuarios u ON f.IdUsuario = u.Id
                INNER JOIN Situacion s ON f.SituacionId = s.Id
                WHERE f.IdUsuario = @usuarioId
                ORDER BY f.FechaCreacion DESC
            `);
        res.json(result.recordset);
    } catch (error) {
        console.error('Error al obtener los tickets:', error);
        res.status(500).json({ error: 'Error al obtener los tickets.' });
    }
});

// Ruta para obtener el nombre del usuario logueado
app.get('/api/usuario', requireLogin, async (req, res) => {
    try {
        const pool = await sql.connect(Config);
        const result = await pool.request()
            .input('id', sql.Int, req.session.userId)
            .query('SELECT Nombre FROM Usuarios WHERE Id = @id');
        if (result.recordset.length > 0) {
            res.json({ nombre: result.recordset[0].Nombre });
        } else {
            res.json({ nombre: 'Usuario' });
        }
    } catch (error) {
        res.json({ nombre: 'Usuario' });
    }
});

// Ruta para enviar encuesta de satisfacción
app.post('/api/satisfaccion', async (req, res) => {
    const {
        serviceType, otherService, serviceDate, source, rating, satisfaction,
        speedRating, kindnessRating, clarityRating, usefulnessRating,
        improvements, recommendationScore, positiveAspects, negativeAspects,
        additionalComments, contactConsent, contactName, contactEmail
    } = req.body;

    try {
        const pool = await sql.connect(Config);
        await pool.request()
            .input('IdUsuario', sql.Int, req.session?.userId || null)
            .input('TipoServicio', sql.NVarChar, serviceType)
            .input('OtroServicio', sql.NVarChar, otherService || null)
            .input('FechaServicio', sql.Date, serviceDate)
            .input('Fuente', sql.NVarChar, source)
            .input('Calificacion', sql.Int, rating)
            .input('Satisfaccion', sql.Int, satisfaction)
            .input('Rapidez', sql.Int, speedRating)
            .input('Amabilidad', sql.Int, kindnessRating)
            .input('Claridad', sql.Int, clarityRating)
            .input('Utilidad', sql.Int, usefulnessRating)
            .input('Mejoras', sql.NVarChar, improvements || null)
            .input('Recomienda', sql.Int, recommendationScore)
            .input('AspectosPositivos', sql.NVarChar, positiveAspects || null)
            .input('AspectosNegativos', sql.NVarChar, negativeAspects || null)
            .input('ComentariosAdicionales', sql.NVarChar, additionalComments || null)
            .input('ConsentimientoContacto', sql.Bit, contactConsent ? 1 : 0)
            .input('NombreContacto', sql.NVarChar, contactName || null)
            .input('EmailContacto', sql.NVarChar, contactEmail || null)
            .query(`
                INSERT INTO Satisfaccion (
                    IdUsuario, TipoServicio, OtroServicio, FechaServicio, Fuente, Calificacion, Satisfaccion,
                    Rapidez, Amabilidad, Claridad, Utilidad, Mejoras, Recomienda, AspectosPositivos,
                    AspectosNegativos, ComentariosAdicionales, ConsentimientoContacto, NombreContacto, EmailContacto
                ) VALUES (
                    @IdUsuario, @TipoServicio, @OtroServicio, @FechaServicio, @Fuente, @Calificacion, @Satisfaccion,
                    @Rapidez, @Amabilidad, @Claridad, @Utilidad, @Mejoras, @Recomienda, @AspectosPositivos,
                    @AspectosNegativos, @ComentariosAdicionales, @ConsentimientoContacto, @NombreContacto, @EmailContacto
                )
            `);
        res.status(201).json({ mensaje: 'Encuesta guardada con éxito.' });
    } catch (error) {
        console.error('Error al guardar la encuesta:', error);
        res.status(500).json({ error: 'Error al guardar la encuesta.' });
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});