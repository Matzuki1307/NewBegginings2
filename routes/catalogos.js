const express = require('express');
const { pool } = require('../DB/db');

const router = express.Router();

// Catálogos públicos que llenan las listas desplegables del formulario
const catalogos = {
    '/api/generos': ['SELECT id AS "Id", descripcion AS "Descripcion" FROM generos ORDER BY id', 'los géneros'],
    '/api/tipos-id': ['SELECT id AS "Id", descripcion AS "Descripcion" FROM tipos_identificacion ORDER BY id', 'los tipos de identificación'],
    '/api/situaciones': ['SELECT id AS "Id", situacion AS "Situacion" FROM situaciones ORDER BY id', 'las situaciones'],
    '/api/departamentos': ['SELECT id AS "Id", nombre AS "Descripcion" FROM departamentos ORDER BY nombre', 'los departamentos'],
    '/api/unidades-medida': ['SELECT id AS "Id", nombre AS "Descripcion" FROM unidades_medida ORDER BY nombre', 'las unidades de medida']
};

for (const [ruta, [consulta, nombre]] of Object.entries(catalogos)) {
    router.get(ruta, async (req, res) => {
        try {
            const result = await pool.query(consulta);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error(`Error al obtener ${nombre}:`, error);
            res.status(500).send(`Error al obtener ${nombre}.`);
        }
    });
}

module.exports = router;
