// Exporta la vista de minería (una fila por ticket) a CSV para analizarla en Python, R, Weka, Excel...
//
// Uso:  npm run mineria:exportar                  -> mineria/tickets.csv
//       npm run mineria:exportar -- mi-archivo.csv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { types } = require('pg');
const { pool } = require('../DB/db');

// Las fechas de la vista ya vienen en hora de Colombia (timestamp sin zona): se exportan tal cual
types.setTypeParser(1114, valor => valor.slice(0, 19));

const destino = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mineria', 'tickets.csv'));

function celda(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return valor.toISOString().replace('T', ' ').slice(0, 19);
    const texto = String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

async function main() {
    // Sin datos personales (nombre, documento, teléfono): solo variables para el análisis
    const { rows, fields } = await pool.query('SELECT * FROM vista_mineria_tickets ORDER BY ticket_id');
    const columnas = fields.map(f => f.name);
    const lineas = [columnas.join(','), ...rows.map(fila => columnas.map(c => celda(fila[c])).join(','))];

    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, '﻿' + lineas.join('\n'), 'utf8'); // BOM para que Excel lea las tildes
    console.log(`${rows.length} filas exportadas a ${destino}`);
}

main()
    .catch(error => {
        console.error('Error:', error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
