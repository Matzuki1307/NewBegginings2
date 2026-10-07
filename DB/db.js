require('dotenv').config(); // Carga las variables de entorno desde .env
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// DATABASE_URL tiene la forma postgres://usuario:clave@host:5432/base
// (para Neon u otro Postgres en la nube, añade ?sslmode=require)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Crea las tablas y carga los catálogos si todavía no existen
async function initDb() {
    const script = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await pool.query(script);
}

module.exports = { pool, initDb };
