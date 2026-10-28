// Herramientas comunes de los tres análisis: azar reproducible, división
// entrenamiento/prueba y estadística descriptiva.

// Proporción de tickets que se usa para entrenar; el resto se reserva para probar
const PROPORCION_ENTRENAMIENTO = 0.7;
const SEMILLA = 2026;

// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da siempre el mismo resultado
function crearAzar(semilla) {
    let a = semilla >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Copia de la lista en otro orden (Fisher-Yates)
function barajar(lista, azar) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

// Divide los índices 0..n-1 en entrenamiento (70 %) y prueba (30 %).
// Con `estratos` (una etiqueta por índice) cada estrato se divide por separado, así las dos
// partes conservan la misma proporción de casos positivos y negativos.
function dividir(n, semilla = SEMILLA, estratos = null, proporcion = PROPORCION_ENTRENAMIENTO) {
    const azar = crearAzar(semilla);
    const grupos = new Map();
    for (let i = 0; i < n; i++) {
        const clave = estratos ? estratos[i] : 0;
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(i);
    }
    const entrenamiento = [];
    const prueba = [];
    for (const clave of [...grupos.keys()].sort()) {
        const barajado = barajar(grupos.get(clave), azar);
        const corte = Math.round(barajado.length * proporcion);
        entrenamiento.push(...barajado.slice(0, corte));
        prueba.push(...barajado.slice(corte));
    }
    // Se ordenan solo para que el resultado sea fácil de revisar; el orden no afecta a los modelos
    entrenamiento.sort((a, b) => a - b);
    prueba.sort((a, b) => a - b);
    return { entrenamiento, prueba };
}

function promedio(valores) {
    return valores.length ? valores.reduce((s, x) => s + x, 0) / valores.length : null;
}

// Percentil p (0 a 1) con interpolación lineal; recibe los valores sin ordenar
function percentil(valores, p) {
    if (valores.length === 0) return null;
    const ordenados = Float64Array.from(valores).sort();
    const i = (ordenados.length - 1) * p;
    const bajo = Math.floor(i);
    const alto = Math.ceil(i);
    return ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (i - bajo);
}

function redondear(valor, decimales = 2) {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
    const factor = 10 ** decimales;
    return Math.round(valor * factor) / factor;
}

// Cuenta cuántas veces aparece cada valor: Map valor -> cantidad
function contar(lista, clave) {
    const conteo = new Map();
    for (const x of lista) {
        const v = clave(x);
        conteo.set(v, (conteo.get(v) || 0) + 1);
    }
    return conteo;
}

module.exports = {
    PROPORCION_ENTRENAMIENTO, SEMILLA,
    crearAzar, barajar, dividir, promedio, percentil, redondear, contar
};
