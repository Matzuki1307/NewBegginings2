require('dotenv').config(); // Carga las variables de entorno desde .env
const sql = require('mssql');

// Configuración de la conexión usando variables de entorno
const config = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    server: process.env.HOST,
    port: parseInt(process.env.PORT, 10), // Agrega el puerto
    database: process.env.DATABASE,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

module.exports = config;


// Conexión y consulta
async function connectAndQuery() {

    console.log('Configuración de la base de datos:', config);
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query('SELECT * FROM Situacion');
        console.log(result.recordset);
    } catch (err) {
        console.error('Error al conectar:', err);
    } finally {
        sql.close(); // Cierra la conexión
    }
}

connectAndQuery();