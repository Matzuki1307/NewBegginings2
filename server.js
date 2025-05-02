const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const Config = require('./DB/db'); // Importa la configuración de la base de datos

const app = express();
const port = 3000;

// Middleware para servir archivos estáticos
app.use(express.static('public'));
app.use(express.static('template'));

// Middleware para parsear JSON
app.use(bodyParser.json());

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/template/index.html');
});

// Ruta para manejar el formulario
app.post('/api/formulario', async (req, res) => {
    const { nombre, tipoId, numeroId, genero, telefono, situacionId } = req.body;

    if (!nombre || !tipoId || !numeroId || !genero || !telefono || !situacionId) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        // Conectar a la base de datos
        const pool = await sql.connect(Config);
        await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .input('tipoId', sql.NVarChar, tipoId)
            .input('numeroId', sql.NVarChar, numeroId)
            .input('genero', sql.NVarChar, genero)
            .input('telefono', sql.NVarChar, telefono)
            .input('situacionId', sql.Int, situacionId) // Guardar el ID de la situación
            .query(`
                INSERT INTO Formulario (Nombre, TipoId, NumeroId, Genero, Telefono, SituacionId)
                VALUES (@nombre, @tipoId, @numeroId, @genero, @telefono, @situacionId)
            `);

        res.status(200).send('Formulario enviado con éxito.');
    } catch (error) {
        console.error('Error al insertar en la base de datos:', error);
        res.status(500).send('Error al procesar el formulario.');
    }
});

// Ruta para obtener las situaciones
app.get('/api/situaciones', async (req, res) => {
    try {
        // Conectar a la base de datos
        const pool = await sql.connect(Config);
        const result = await pool.request().query('SELECT id, situacion FROM Situacion ORDER BY id');

        res.status(200).json(result.recordset); // Enviar las situaciones como JSON
    } catch (error) {
        console.error('Error al obtener las situaciones:', error);
        res.status(500).send('Error al obtener las situaciones.');
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});