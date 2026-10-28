// Reglas de asociación: "si pasa A, suele pasar B".
//
// Cada ticket es una "transacción" con las características que tiene (situación, departamento,
// horario...). Se buscan combinaciones frecuentes y se miden con tres números:
//   soporte   = qué fracción de los tickets cumple la regla completa (A y B)
//   confianza = de los tickets con A, qué fracción también tiene B
//   lift      = cuántas veces es más probable B cuando hay A que en general (1 = sin relación)
//
// Las reglas se buscan con el 70 % de los tickets y se comprueban con el 30 % restante:
// una regla es estable si su confianza se mantiene en tickets que no se usaron para encontrarla.

const { dividir, percentil, redondear } = require('./base');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const MIN_TICKETS = 100;
const MIN_CASOS = 20;            // aunque el soporte sea bajo, una regla necesita al menos estos tickets
const MIN_LIFT = 1.2;
const MEJORA_MINIMA = 0.02;      // una regla de 2 condiciones debe mejorar a sus versiones de 1 condición
const TOLERANCIA_ESTABLE = 0.1;  // diferencia máxima de confianza entre entrenamiento y prueba
const MAX_REGLAS_POR_TEMA = 40;

// Cada ticket aporta una "palabra" por variable; null significa que no aporta nada.
// Las características muy comunes que no informan (ser entre semana, no ser reincidente)
// no se incluyen: solo cuenta lo que sí ocurre.
// Hay variables que se dejan fuera a propósito porque solo producirían reglas obvias:
//   - la demanda reciente del departamento: se calcula con el propio departamento y la fecha
//     ("pico + junio ⇒ Chocó");
//   - la tierra abandonada: el formulario solo la pide en desplazamiento forzado.
function definirItems(entrenamiento) {
    const congestion = percentil(entrenamiento.map(t => t.congestion), 0.75);

    return [
        { variable: 'Situación', valor: t => t.situacion },
        { variable: 'Departamento', valor: t => t.departamento },
        { variable: 'Género', valor: t => t.genero },
        { variable: 'Documento', valor: t => t.tipoId },
        { variable: 'Horario', valor: t => t.franja },
        { variable: 'Día', valor: t => (t.finSemana ? 'Fin de semana' : null) },
        { variable: 'Mes', valor: t => MESES[t.mes - 1] },
        { variable: 'Reincidencia', valor: t => (t.reincidente ? 'Persona reincidente' : null) },
        { variable: 'Congestión al crear', valor: t => (t.congestion >= congestion ? 'Alta (cuartil superior)' : null) },
        // Resultados: solo cuando se conocen con certeza (plazo del ANS vencido)
        { variable: 'Cumplimiento del ANS', valor: t => (t.etiqueta === null ? null : t.etiqueta === 1 ? 'Incumplido' : 'Cumplido') },
        { variable: 'Reapertura', valor: t => (t.cerradoOk && t.reaperturas > 0 ? 'Fue reabierto' : null) },
        { variable: 'Satisfacción', valor: t => (t.calificacion === null ? null : t.calificacion >= 4 ? 'Alta (4 o 5)' : t.calificacion <= 2 ? 'Baja (1 o 2)' : null) }
    ];
}

// ===== Conjuntos de bits =====

function crearBits(n) {
    return new Uint32Array(Math.ceil(n / 32));
}

function contarBits(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

function contarY(a, b, c = null) {
    let total = 0;
    for (let w = 0; w < a.length; w++) total += contarBits(c ? a[w] & b[w] & c[w] : a[w] & b[w]);
    return total;
}

// Para cada ítem, el conjunto de tickets que lo tienen
function construirBits(transacciones, cantidadItems) {
    const bits = Array.from({ length: cantidadItems }, () => crearBits(transacciones.length));
    transacciones.forEach((items, t) => {
        for (const i of items) bits[i][t >> 5] |= 1 << (t & 31);
    });
    return bits;
}

// ===== Búsqueda =====

// Devuelve las reglas A → B (B es un solo ítem; A tiene 1 o 2 ítems)
function buscarReglas(bits, cantidadItems, variables, n, minCasos, minConfianza) {
    const unarios = bits.map(b => contarY(b, b));
    const frecuentes = [];
    for (let i = 0; i < cantidadItems; i++) if (unarios[i] >= minCasos) frecuentes.push(i);

    // Parejas frecuentes (con ítems de variables distintas: un ticket no puede tener dos departamentos)
    const pares = new Map();
    const llave = (i, j) => (i < j ? i * cantidadItems + j : j * cantidadItems + i);
    for (let a = 0; a < frecuentes.length; a++) {
        for (let b = a + 1; b < frecuentes.length; b++) {
            const i = frecuentes[a], j = frecuentes[b];
            if (variables[i] === variables[j]) continue;
            const casos = contarY(bits[i], bits[j]);
            if (casos >= minCasos) pares.set(llave(i, j), casos);
        }
    }

    const reglas = [];
    const agregar = (antecedente, consecuente, casos, casosAntecedente) => {
        const confianza = casos / casosAntecedente;
        const lift = confianza / (unarios[consecuente] / n);
        if (confianza >= minConfianza && lift >= MIN_LIFT) {
            reglas.push({ antecedente, consecuente, casos, casosAntecedente, confianza, lift });
        }
    };

    // Reglas con una condición
    for (const [clave, casos] of pares) {
        const i = Math.floor(clave / cantidadItems), j = clave % cantidadItems;
        agregar([i], j, casos, unarios[i]);
        agregar([j], i, casos, unarios[j]);
    }

    // Reglas con dos condiciones: solo se guardan si mejoran claramente a las de una
    const idsPares = [...pares.keys()];
    const porItem = new Map();
    for (const clave of idsPares) {
        const i = Math.floor(clave / cantidadItems), j = clave % cantidadItems;
        if (!porItem.has(i)) porItem.set(i, []);
        if (!porItem.has(j)) porItem.set(j, []);
        porItem.get(i).push(j);
        porItem.get(j).push(i);
    }
    for (const clave of idsPares) {
        const i = Math.floor(clave / cantidadItems), j = clave % cantidadItems;
        for (const k of porItem.get(i) || []) {
            if (k <= j || variables[k] === variables[j]) continue;
            // Para que {i, j, k} sea frecuente, las tres parejas deben serlo
            if (!pares.has(llave(j, k))) continue;
            const casos = contarY(bits[i], bits[j], bits[k]);
            if (casos < minCasos) continue;

            for (const [a, b, c] of [[i, j, k], [i, k, j], [j, k, i]]) {
                const casosAntecedente = pares.get(llave(a, b));
                const confianza = casos / casosAntecedente;
                const mejorSimple = Math.max(pares.get(llave(a, c)) / unarios[a], pares.get(llave(b, c)) / unarios[b]);
                if (confianza - mejorSimple >= MEJORA_MINIMA) agregar([a, b], c, casos, casosAntecedente);
            }
        }
    }
    return { reglas, unarios };
}

// ===== Análisis completo =====

function analizarReglas(tickets, { minSoporte = 0.01, minConfianza = 0.6, semilla } = {}) {
    if (tickets.length < MIN_TICKETS) {
        return { disponible: false, motivo: `Hacen falta al menos ${MIN_TICKETS} tickets para buscar reglas; hay ${tickets.length}.` };
    }

    const { entrenamiento, prueba } = dividir(tickets.length, semilla);
    const dTrain = entrenamiento.map(i => tickets[i]);
    const dTest = prueba.map(i => tickets[i]);

    // Diccionario de ítems, construido solo con el entrenamiento
    const definicion = definirItems(dTrain);
    const indice = new Map(); // "variable|valor" -> número de ítem
    const items = [];         // número de ítem -> { variable, valor }
    const transaccionesDe = (lista, ampliar) => lista.map(t => {
        const ids = [];
        for (const { variable, valor } of definicion) {
            const v = valor(t);
            if (v === null || v === undefined) continue;
            const clave = `${variable}|${v}`;
            if (!indice.has(clave)) {
                if (!ampliar) continue; // un ítem que no existe en el entrenamiento no puede formar parte de ninguna regla
                indice.set(clave, items.length);
                items.push({ variable, valor: v });
            }
            ids.push(indice.get(clave));
        }
        return ids;
    });
    const tTrain = transaccionesDe(dTrain, true);
    const tTest = transaccionesDe(dTest, false);

    const bitsTrain = construirBits(tTrain, items.length);
    const bitsTest = construirBits(tTest, items.length);
    const variables = items.map(i => i.variable);

    const minCasos = Math.max(MIN_CASOS, Math.ceil(minSoporte * dTrain.length));
    const { reglas, unarios } = buscarReglas(bitsTrain, items.length, variables, dTrain.length, minCasos, minConfianza);

    reglas.sort((a, b) => b.lift - a.lift || b.confianza - a.confianza || b.casos - a.casos);

    // Comprobación con el 30 %: la misma regla sobre tickets que no se usaron para encontrarla
    const nTest = dTest.length;
    const conteoTest = bitsTest.map(b => contarY(b, b));
    const evaluada = reglas.map(r => {
        const [a, b] = r.antecedente;
        const casosAntecedente = b === undefined ? conteoTest[a] : contarY(bitsTest[a], bitsTest[b]);
        const casos = b === undefined
            ? contarY(bitsTest[a], bitsTest[r.consecuente])
            : contarY(bitsTest[a], bitsTest[b], bitsTest[r.consecuente]);
        const confianzaPrueba = casosAntecedente > 0 ? casos / casosAntecedente : null;
        const liftPrueba = confianzaPrueba !== null && conteoTest[r.consecuente] > 0
            ? confianzaPrueba / (conteoTest[r.consecuente] / nTest) : null;
        const estable = confianzaPrueba !== null && casosAntecedente >= 5
            && Math.abs(confianzaPrueba - r.confianza) <= TOLERANCIA_ESTABLE && liftPrueba >= 1;
        return {
            antecedente: r.antecedente.map(i => items[i]),
            consecuente: items[r.consecuente],
            casos: r.casos,
            soporte: redondear(r.casos / dTrain.length, 4),
            confianza: redondear(r.confianza, 3),
            lift: redondear(r.lift, 2),
            prueba: {
                casos,
                casosAntecedente,
                soporte: redondear(casos / nTest, 4),
                confianza: redondear(confianzaPrueba, 3),
                lift: redondear(liftPrueba, 2)
            },
            estable
        };
    });

    // Se muestran las mejores de cada tema (según lo que predicen), para que las de lift alto
    // no tapen a las que hablan de la atención o de la satisfacción
    const porTema = new Map();
    for (const regla of evaluada) {
        const tema = regla.consecuente.variable;
        if (!porTema.has(tema)) porTema.set(tema, []);
        if (porTema.get(tema).length < MAX_REGLAS_POR_TEMA) porTema.get(tema).push(regla);
    }
    const mostradas = [...porTema.values()].flat().sort((a, b) => b.lift - a.lift || b.confianza - a.confianza || b.casos - a.casos);
    return {
        disponible: true,
        parametros: { minSoporte, minConfianza, minLift: MIN_LIFT, minCasos },
        division: { entrenamiento: dTrain.length, prueba: nTest, total: tickets.length },
        items: items.length,
        itemsFrecuentes: unarios.filter(c => c >= minCasos).length,
        encontradas: reglas.length,
        estables: mostradas.filter(r => r.estable).length,
        reglas: mostradas
    };
}

module.exports = { analizarReglas, definirItems, buscarReglas, construirBits, contarY };
