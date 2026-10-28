const express = require('express');
const { pool } = require('../DB/db');
const { requirePermiso } = require('../middleware/auth');
const { cargarTickets } = require('../lib/analitica/datos');
const { analizarGrupos } = require('../lib/analitica/grupos');
const { analizarReglas } = require('../lib/analitica/reglas');
const { analizarRiesgo } = require('../lib/analitica/riesgo');

const router = express.Router();

// Los análisis son costosos y los tickets no cambian cada segundo: cada resultado se guarda unos minutos.
// El botón "Actualizar" de la página fuerza un nuevo cálculo, pero como máximo una vez cada 30 segundos.
const VIGENCIA_MS = 10 * 60 * 1000;
const ESPERA_ACTUALIZAR_MS = 30 * 1000;
const cache = new Map();
let ultimaActualizacion = 0;

// Devuelve el resultado guardado o lo calcula. Si dos personas lo piden a la vez, se calcula una sola vez.
function obtener(clave, calcular, actualizar) {
    const ahora = Date.now();
    if (actualizar && ahora - ultimaActualizacion >= ESPERA_ACTUALIZAR_MS) {
        cache.clear();
        ultimaActualizacion = ahora;
    }
    const guardado = cache.get(clave);
    if (guardado && guardado.expira > ahora) return guardado.promesa;

    const promesa = (async () => {
        const datos = await tickets();
        // Deja que la base de datos y otras peticiones avancen antes del cálculo, que ocupa el procesador
        await new Promise(resolver => setImmediate(resolver));
        return { generado: new Date().toISOString(), ...calcular(datos.tickets) };
    })();
    cache.set(clave, { expira: ahora + VIGENCIA_MS, promesa });
    // Si falla no se guarda el error
    promesa.catch(() => { if (cache.get(clave)?.promesa === promesa) cache.delete(clave); });
    return promesa;
}

function tickets() {
    const guardado = cache.get('tickets');
    if (guardado && guardado.expira > Date.now()) return guardado.promesa;
    const promesa = cargarTickets(pool);
    cache.set('tickets', { expira: Date.now() + VIGENCIA_MS, promesa });
    promesa.catch(() => { if (cache.get('tickets')?.promesa === promesa) cache.delete('tickets'); });
    return promesa;
}

const quiereActualizar = req => req.query.actualizar === '1';

// Grupos de casos (k-means). k: "auto" (el mejor según la silueta) o un número de 2 a 8
router.get('/api/mineria/grupos', requirePermiso('mineria.ver'), async (req, res) => {
    const pedido = req.query.k === undefined || req.query.k === 'auto' ? null : Number(req.query.k);
    if (pedido !== null && !(Number.isInteger(pedido) && pedido >= 2 && pedido <= 8)) {
        return res.status(400).json({ error: 'El número de grupos debe ser "auto" o un entero entre 2 y 8.' });
    }
    res.json(await obtener(`grupos:${pedido}`, lista => analizarGrupos(lista, { k: pedido }), quiereActualizar(req)));
});

// Reglas de asociación (Eclat). soporte y confianza en fracción: 0,01 = 1 %
const SOPORTES = [0.005, 0.01, 0.02, 0.05];
const CONFIANZAS = [0.4, 0.5, 0.6, 0.7, 0.8];

router.get('/api/mineria/reglas', requirePermiso('mineria.ver'), async (req, res) => {
    const soporte = req.query.soporte === undefined ? 0.01 : Number(req.query.soporte);
    const confianza = req.query.confianza === undefined ? 0.6 : Number(req.query.confianza);
    if (!SOPORTES.includes(soporte) || !CONFIANZAS.includes(confianza)) {
        return res.status(400).json({ error: 'El soporte o la confianza elegidos no son válidos.' });
    }
    res.json(await obtener(`reglas:${soporte}:${confianza}`,
        lista => analizarReglas(lista, { minSoporte: soporte, minConfianza: confianza }), quiereActualizar(req)));
});

// Riesgo de demora (regresión logística y árbol de decisión) y puntuación de los tickets abiertos
router.get('/api/mineria/riesgo', requirePermiso('mineria.ver'), async (req, res) => {
    res.json(await obtener('riesgo', lista => analizarRiesgo(lista), quiereActualizar(req)));
});

module.exports = router;
