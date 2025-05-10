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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/template/index.html');
});

// Ruta para manejar el formulario
app.post('/api/formulario', async (req, res) => {
    const { nombre, tipoId, numeroId, genero, telefono, situacionId, departamento } = req.body;

    if (!nombre || !tipoId || !numeroId || !genero || !telefono || !situacionId || !departamento) {
        return res.status(400).send('Todos los campos son obligatorios.');
    }

    try {
        const pool = await sql.connect(Config);
        await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .input('tipoId', sql.NVarChar, tipoId)
            .input('numeroId', sql.NVarChar, numeroId)
            .input('genero', sql.NVarChar, genero)
            .input('telefono', sql.NVarChar, telefono)
            .input('situacionId', sql.Int, situacionId)
            .input('departamento', sql.Int, departamento) // Agregar el departamento
            .query(`
                INSERT INTO Formulario (Nombre, TipoId, NumeroId, Genero, Telefono, SituacionId, DepartamentoId)
                VALUES (@nombre, @tipoId, @numeroId, @genero, @telefono, @situacionId, @departamento)
            `);

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
        res.status(200).json(result.recordset);
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

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});