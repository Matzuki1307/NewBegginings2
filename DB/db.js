require('dotenv').config(); // Carga las variables de entorno desde .env
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// DATABASE_URL tiene la forma postgres://usuario:clave@host:5432/base
// (para Neon u otro Postgres en la nube, añade ?sslmode=verify-full)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Crea el primer administrador a partir de ADMIN_EMAIL y ADMIN_PASSWORD.
// Si el correo ya existe no hace nada, para no pisar cambios hechos desde la app.
async function crearAdminInicial() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
    if (existe.rows.length > 0) return;

    const hash = await bcrypt.hash(password, 10);
    await pool.query(`
        INSERT INTO usuarios (nombre, apellido, email, password, rol_id)
        VALUES ('Administrador', 'New Beginnings', $1, $2, (SELECT id FROM roles WHERE es_admin ORDER BY id LIMIT 1))
    `, [email, hash]);
    console.log(`Administrador inicial creado: ${email}`);
}

// Crea las tablas, carga los catálogos y el administrador inicial si todavía no existen
async function initDb() {
    const script = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await pool.query(script);
    await crearAdminInicial();
}

// Ejecuta varias consultas como una sola operación: si una falla, no se guarda ninguna
async function transaccion(trabajo) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await trabajo(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { pool, initDb, transaccion };
