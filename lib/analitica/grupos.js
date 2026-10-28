// Grupos de casos: k-means sobre las características de cada ticket.
//
// Cómo funciona:
//   1. Cada ticket se convierte en un vector de números (las categorías se vuelven columnas 0/1).
//   2. Con el 70 % de los tickets se prueban varios números de grupos (k) y se elige el que
//      separa mejor, según el coeficiente de silueta.
//   3. Con el 30 % restante se comprueba que los grupos se sostienen: se asignan esos tickets
//      al centro más cercano y se vuelve a medir la silueta.
//   4. Cada ticket se asigna a su grupo y se describe qué tiene en común y cómo se atendió.

const { crearAzar, barajar, dividir, promedio, percentil, redondear, contar } = require('./base');

const K_MIN = 2;
const K_MAX = 8;
const REINICIOS = 5;          // k-means depende del punto de partida: se repite y se queda con el mejor
const MAX_ITERACIONES = 100;
const MUESTRA_SILUETA = 900;  // la silueta compara todos los pares: se calcula sobre una muestra
const MUESTRA_PUNTOS = 600;   // puntos que se dibujan en el mapa de grupos
const MIN_TICKETS = 60;

// Cuánto influye cada variable al medir la distancia entre dos tickets
const PESOS = { situacion: 1, region: 1.3, genero: 0.6, documento: 0.8, horario: 0.5, mes: 0.8, finSemana: 0.5, reincidente: 0.5 };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ===== Variables =====

// Regiones naturales de Colombia: agrupar por región evita que los 33 departamentos dominen la distancia
const REGIONES = {
    'Bogotá D.C.': 'Bogotá D.C.',
    'Antioquia': 'Andina', 'Boyacá': 'Andina', 'Caldas': 'Andina', 'Cundinamarca': 'Andina', 'Huila': 'Andina',
    'Norte de Santander': 'Andina', 'Quindío': 'Andina', 'Risaralda': 'Andina', 'Santander': 'Andina', 'Tolima': 'Andina',
    'Atlántico': 'Caribe', 'Bolívar': 'Caribe', 'Cesar': 'Caribe', 'Córdoba': 'Caribe', 'La Guajira': 'Caribe',
    'Magdalena': 'Caribe', 'Sucre': 'Caribe', 'San Andrés y Providencia': 'Caribe',
    'Cauca': 'Pacífica', 'Chocó': 'Pacífica', 'Nariño': 'Pacífica', 'Valle del Cauca': 'Pacífica',
    'Arauca': 'Orinoquía', 'Casanare': 'Orinoquía', 'Meta': 'Orinoquía', 'Vichada': 'Orinoquía',
    'Amazonas': 'Amazonía', 'Caquetá': 'Amazonía', 'Guainía': 'Amazonía', 'Guaviare': 'Amazonía',
    'Putumayo': 'Amazonía', 'Vaupés': 'Amazonía'
};
const NOMBRES_REGION = ['Andina', 'Bogotá D.C.', 'Caribe', 'Pacífica', 'Orinoquía', 'Amazonía'];

// Define las columnas numéricas a partir de los datos de entrenamiento.
// `peso` indica cuánto influye la variable al medir la distancia entre dos tickets.
function definirColumnas(tickets, pesos) {
    const columnas = [];
    const categoria = (variable, valores, extraer, peso) => {
        for (const valor of valores) {
            columnas.push({ variable, valor, peso, valorDe: t => (extraer(t) === valor ? 1 : 0) });
        }
    };

    const situaciones = [...new Set(tickets.map(t => t.situacion ?? 'Sin dato'))].sort();
    categoria('Situación', situaciones, t => t.situacion ?? 'Sin dato', pesos.situacion);

    // La ubicación se mide por región; el departamento exacto aparece luego al describir cada grupo
    categoria('Región', [...NOMBRES_REGION, 'Sin dato'], t => REGIONES[t.departamento] ?? 'Sin dato', pesos.region);

    const genero = t => (t.genero === 'Femenino' || t.genero === 'Masculino' ? t.genero : 'Otro género o sin dato');
    categoria('Género', ['Femenino', 'Masculino', 'Otro género o sin dato'], genero, pesos.genero);

    const documento = t => (t.extranjero ? 'Persona extranjera' : t.menor ? 'Menor de edad' : 'Adulto colombiano');
    categoria('Documento', ['Adulto colombiano', 'Persona extranjera', 'Menor de edad'], documento, pesos.documento);

    categoria('Horario', ['Madrugada', 'Mañana', 'Tarde', 'Noche'], t => t.franja, pesos.horario);

    // El mes es cíclico (diciembre queda al lado de enero): se representa con seno y coseno
    columnas.push({ variable: 'Mes', valor: 'sen', peso: pesos.mes, valorDe: t => 0.5 * Math.sin(2 * Math.PI * t.mes / 12) });
    columnas.push({ variable: 'Mes', valor: 'cos', peso: pesos.mes, valorDe: t => 0.5 * Math.cos(2 * Math.PI * t.mes / 12) });

    columnas.push({ variable: 'Fin de semana', valor: 'Sí', peso: pesos.finSemana, valorDe: t => (t.finSemana ? 1 : 0) });
    columnas.push({ variable: 'Reincidente', valor: 'Sí', peso: pesos.reincidente, valorDe: t => (t.reincidente ? 1 : 0) });
    return columnas;
}

function construirMatriz(tickets, columnas) {
    const d = columnas.length;
    const X = new Float64Array(tickets.length * d);
    tickets.forEach((t, i) => {
        columnas.forEach((c, j) => { X[i * d + j] = c.valorDe(t) * c.peso; });
    });
    return X;
}

// ===== k-means =====

function distancia2(X, i, C, c, d) {
    let suma = 0;
    for (let j = 0; j < d; j++) {
        const dif = X[i * d + j] - C[c * d + j];
        suma += dif * dif;
    }
    return suma;
}

// Centro más cercano a cada fila de X
function asignar(X, n, C, k, d) {
    const asignacion = new Int32Array(n);
    let inercia = 0;
    for (let i = 0; i < n; i++) {
        let mejor = 0, mejorDist = Infinity;
        for (let c = 0; c < k; c++) {
            const dist = distancia2(X, i, C, c, d);
            if (dist < mejorDist) { mejorDist = dist; mejor = c; }
        }
        asignacion[i] = mejor;
        inercia += mejorDist;
    }
    return { asignacion, inercia };
}

// k-means++: el primer centro es al azar y cada nuevo centro se sortea con más
// probabilidad cuanto más lejos esté de los ya elegidos
function iniciarCentros(X, n, k, d, azar) {
    const C = new Float64Array(k * d);
    const primero = Math.floor(azar() * n);
    C.set(X.subarray(primero * d, primero * d + d), 0);
    const dist = new Float64Array(n).fill(Infinity);
    for (let c = 1; c < k; c++) {
        let total = 0;
        for (let i = 0; i < n; i++) {
            dist[i] = Math.min(dist[i], distancia2(X, i, C, c - 1, d));
            total += dist[i];
        }
        let objetivo = azar() * total;
        let elegido = n - 1;
        for (let i = 0; i < n; i++) {
            objetivo -= dist[i];
            if (objetivo <= 0) { elegido = i; break; }
        }
        C.set(X.subarray(elegido * d, elegido * d + d), c * d);
    }
    return C;
}

function kmeansUnaVez(X, n, k, d, azar) {
    let C = iniciarCentros(X, n, k, d, azar);
    let asignacion = new Int32Array(n).fill(-1);
    let inercia = Infinity;

    for (let iteracion = 0; iteracion < MAX_ITERACIONES; iteracion++) {
        const nueva = asignar(X, n, C, k, d);
        inercia = nueva.inercia;
        const cambio = nueva.asignacion.some((c, i) => c !== asignacion[i]);
        asignacion = nueva.asignacion;
        if (!cambio) break;

        // Cada centro pasa a ser el promedio de sus tickets
        const suma = new Float64Array(k * d);
        const tamano = new Int32Array(k);
        for (let i = 0; i < n; i++) {
            const c = asignacion[i];
            tamano[c]++;
            for (let j = 0; j < d; j++) suma[c * d + j] += X[i * d + j];
        }
        for (let c = 0; c < k; c++) {
            if (tamano[c] === 0) {
                // Grupo vacío: se reinicia en el ticket más alejado de su centro
                let lejano = 0, lejanoDist = -1;
                for (let i = 0; i < n; i++) {
                    const dist = distancia2(X, i, C, asignacion[i], d);
                    if (dist > lejanoDist) { lejanoDist = dist; lejano = i; }
                }
                C.set(X.subarray(lejano * d, lejano * d + d), c * d);
            } else {
                for (let j = 0; j < d; j++) C[c * d + j] = suma[c * d + j] / tamano[c];
            }
        }
    }
    return { C, asignacion, inercia };
}

function kmeans(X, n, k, d, azar) {
    let mejor = null;
    for (let r = 0; r < REINICIOS; r++) {
        const intento = kmeansUnaVez(X, n, k, d, azar);
        if (!mejor || intento.inercia < mejor.inercia) mejor = intento;
    }
    return mejor;
}

// Coeficiente de silueta (de -1 a 1): qué tan cerca está cada ticket de su grupo comparado con
// el grupo vecino más cercano. Cerca de 1 = grupos bien separados; cerca de 0 = grupos que se traslapan.
function silueta(X, d, asignacion, indices, k) {
    const m = indices.length;
    const grupos = Array.from({ length: k }, () => []);
    indices.forEach((fila, p) => grupos[asignacion[fila]].push(p));
    const distanciaEntre = (p, q) => {
        let suma = 0;
        const a = indices[p] * d, b = indices[q] * d;
        for (let j = 0; j < d; j++) { const dif = X[a + j] - X[b + j]; suma += dif * dif; }
        return Math.sqrt(suma);
    };

    let total = 0, contados = 0;
    for (let p = 0; p < m; p++) {
        const propio = asignacion[indices[p]];
        if (grupos[propio].length < 2) continue; // un grupo de un solo ticket no mide nada
        let a = 0;
        for (const q of grupos[propio]) if (q !== p) a += distanciaEntre(p, q);
        a /= grupos[propio].length - 1;
        let b = Infinity;
        for (let g = 0; g < k; g++) {
            if (g === propio || grupos[g].length === 0) continue;
            let suma = 0;
            for (const q of grupos[g]) suma += distanciaEntre(p, q);
            b = Math.min(b, suma / grupos[g].length);
        }
        if (!Number.isFinite(b)) continue;
        total += (b - a) / Math.max(a, b, 1e-12);
        contados++;
    }
    return contados ? total / contados : 0;
}

// ===== Mapa en 2 dimensiones (componentes principales) =====

// Proyecta los datos sobre las dos direcciones en las que más varían (PCA por iteración de potencia)
function componentesPrincipales(X, n, d, azar) {
    const media = new Float64Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) media[j] += X[i * d + j] / n;

    const cov = Array.from({ length: d }, () => new Float64Array(d));
    for (let i = 0; i < n; i++) {
        for (let a = 0; a < d; a++) {
            const va = X[i * d + a] - media[a];
            if (va === 0) continue;
            for (let b = a; b < d; b++) cov[a][b] += va * (X[i * d + b] - media[b]) / n;
        }
    }
    for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a];

    const componentes = [];
    const varianzas = [];
    for (let c = 0; c < 2; c++) {
        let v = Float64Array.from({ length: d }, () => azar() - 0.5);
        let autovalor = 0;
        for (let it = 0; it < 200; it++) {
            const w = new Float64Array(d);
            for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += cov[a][b] * v[b]; w[a] = s; }
            const norma = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
            autovalor = norma;
            for (let a = 0; a < d; a++) v[a] = w[a] / norma;
        }
        componentes.push(v);
        varianzas.push(autovalor);
        // Se resta esta dirección para que la siguiente busque otra distinta
        for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) cov[a][b] -= autovalor * v[a] * v[b];
    }
    const total = (() => { let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) s += (X[i * d + j] - media[j]) ** 2; return s / n; })();
    return { media, componentes, varianzaExplicada: total > 0 ? (varianzas[0] + varianzas[1]) / total : 0 };
}

function proyectar(X, i, d, pca) {
    const punto = [0, 0];
    for (let c = 0; c < 2; c++) {
        for (let j = 0; j < d; j++) punto[c] += (X[i * d + j] - pca.media[j]) * pca.componentes[c][j];
    }
    return punto;
}

// ===== Descripción de cada grupo =====

// Variables categóricas con las que se describe cada grupo (no son las únicas que se usaron para agrupar)
const DESCRIPTORES = [
    { variable: 'Situación', valor: t => t.situacion ?? 'Sin dato' },
    { variable: 'Región', valor: t => REGIONES[t.departamento] ?? 'Sin dato' },
    { variable: 'Departamento', valor: t => t.departamento ?? 'Sin dato' },
    { variable: 'Género', valor: t => t.genero ?? 'Sin dato' },
    { variable: 'Documento', valor: t => (t.extranjero ? 'Personas extranjeras' : t.menor ? 'Menores de edad' : null) },
    { variable: 'Horario', valor: t => t.franja },
    { variable: 'Mes', valor: t => MESES[t.mes - 1] },
    { variable: 'Fin de semana', valor: t => (t.finSemana ? 'Fin de semana' : null) },
    { variable: 'Reincidencia', valor: t => (t.reincidente ? 'Personas reincidentes' : null) }
];

function porcentaje(parte, total) {
    return total ? redondear((parte / total) * 100, 1) : 0;
}

// Nombre corto del grupo: la(s) situación(es) que dominan y, después, lo que más lo distingue
// (el departamento si uno solo domina, si no la región, si no otra característica)
function nombrarGrupo(situaciones, departamentos, rasgos) {
    const principales = situaciones.filter(s => s.porcentaje >= 30);
    const parteSituacion = principales.length === 0 ? 'Casos mixtos'
        : principales[0].porcentaje >= 70 ? principales[0].nombre
            : principales.slice(0, 2).map(s => s.nombre).join(' y ');

    const departamento = departamentos[0];
    // Regiones que juntas explican la mayor parte del grupo (si son varias, se nombran todas)
    const regiones = rasgos.filter(r => r.variable === 'Región' && r.porcentaje >= 20 && r.lift >= 1.5)
        .sort((a, b) => b.porcentaje - a.porcentaje).slice(0, 3);
    const cubierto = regiones.reduce((s, r) => s + r.porcentaje, 0);
    let distintivo = null;
    if (departamento && departamento.porcentaje >= 40 && departamento.lift >= 3) distintivo = departamento.nombre;
    else if (regiones.length === 1 && cubierto >= 60) {
        distintivo = regiones[0].valor === 'Bogotá D.C.' ? regiones[0].valor : `región ${regiones[0].valor}`;
    } else if (regiones.length > 1 && cubierto >= 70) {
        const nombres = regiones.map(r => r.valor);
        distintivo = `regiones ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
    } else {
        const otro = rasgos.find(r => ['Documento', 'Reincidencia', 'Mes', 'Horario', 'Fin de semana'].includes(r.variable));
        if (otro) distintivo = otro.variable === 'Mes' ? `en ${otro.valor}` : otro.valor;
    }
    return distintivo ? `${parteSituacion} · ${distintivo}` : parteSituacion;
}

function describirGrupo(id, miembros, todos) {
    const n = miembros.length;
    const cerrados = miembros.filter(t => t.cerradoOk);

    // Rasgos: valores mucho más frecuentes en el grupo que en el total
    const rasgos = [];
    for (const { variable, valor } of DESCRIPTORES) {
        const enGrupo = contar(miembros, valor);
        const enTotal = contar(todos, valor);
        for (const [v, c] of enGrupo) {
            if (v === null || v === 'Sin dato') continue;
            const compartidoGrupo = c / n;
            const compartidoTotal = enTotal.get(v) / todos.length;
            const lift = compartidoGrupo / compartidoTotal;
            // Un rasgo cuenta si es claro: domina el grupo, o es notablemente más frecuente que en el total
            if ((compartidoGrupo >= 0.5 && lift >= 1.15) || (compartidoGrupo >= 0.12 && lift >= 1.6)) {
                rasgos.push({ variable, valor: v, porcentaje: porcentaje(c, n), lift: redondear(lift, 1) });
            }
        }
    }
    rasgos.sort((a, b) => b.lift * b.porcentaje - a.lift * a.porcentaje);
    // Bogotá es a la vez región y departamento: no se repite
    const regionesDelGrupo = new Set(rasgos.filter(r => r.variable === 'Región').map(r => r.valor));
    for (let i = rasgos.length - 1; i >= 0; i--) {
        if (rasgos[i].variable === 'Departamento' && regionesDelGrupo.has(rasgos[i].valor)) rasgos.splice(i, 1);
    }

    const top = (clave, cuantos) => [...contar(miembros, clave)]
        .filter(([v]) => v !== null)
        .sort((a, b) => b[1] - a[1]).slice(0, cuantos)
        .map(([nombre, c]) => ({
            nombre, porcentaje: porcentaje(c, n),
            lift: redondear((c / n) / (todos.filter(t => clave(t) === nombre).length / todos.length), 1)
        }));

    const situaciones = top(t => t.situacion ?? 'Sin dato', 3);
    const departamentos = top(t => t.departamento ?? 'Sin dato', 3);

    const nombre = nombrarGrupo(situaciones, departamentos, rasgos);

    const duraciones = cerrados.map(t => t.duracionDias);
    const conAns = cerrados.filter(t => t.ans !== null);
    const calificaciones = miembros.filter(t => t.calificacion !== null).map(t => t.calificacion);

    return {
        id,
        nombre,
        tamano: n,
        porcentaje: porcentaje(n, todos.length),
        situaciones,
        departamentos,
        rasgos: rasgos.slice(0, 6),
        atencion: {
            cerrados: cerrados.length,
            abiertos: miembros.filter(t => t.abierto).length,
            medianaDias: redondear(percentil(duraciones, 0.5), 1),
            incumpleAns: conAns.length ? porcentaje(conAns.filter(t => t.duracionDias > t.ans).length, conAns.length) : null,
            reaperturas: cerrados.length ? porcentaje(cerrados.filter(t => t.reaperturas > 0).length, cerrados.length) : null,
            calificacion: calificaciones.length >= 5 ? redondear(promedio(calificaciones), 2) : null,
            encuestas: calificaciones.length
        }
    };
}

// ===== Análisis completo =====

function analizarGrupos(tickets, { k = null, semilla, pesos = PESOS } = {}) {
    if (tickets.length < MIN_TICKETS) {
        return { disponible: false, motivo: `Hacen falta al menos ${MIN_TICKETS} tickets para formar grupos; hay ${tickets.length}.` };
    }

    // 70 % para entrenar y 30 % para comprobar
    const { entrenamiento, prueba } = dividir(tickets.length, semilla);
    const dTrain = entrenamiento.map(i => tickets[i]);
    const dTest = prueba.map(i => tickets[i]);
    const azar = crearAzar((semilla ?? 2026) + 1);

    const columnas = definirColumnas(dTrain, { ...PESOS, ...pesos });
    const d = columnas.length;
    const XTrain = construirMatriz(dTrain, columnas);
    const XTest = construirMatriz(dTest, columnas);
    const nTrain = dTrain.length, nTest = dTest.length;

    const muestraDe = (n) => barajar(Array.from({ length: n }, (_, i) => i), azar).slice(0, MUESTRA_SILUETA);
    const muestraTrain = muestraDe(nTrain);
    const muestraTest = muestraDe(nTest);

    // Se prueban varios k con el 70 %
    const kMax = Math.min(K_MAX, Math.floor(nTrain / 10));
    const modelos = [];
    for (let kk = K_MIN; kk <= kMax; kk++) {
        const modelo = kmeans(XTrain, nTrain, kk, d, azar);
        modelos.push({ k: kk, ...modelo, silueta: silueta(XTrain, d, modelo.asignacion, muestraTrain, kk) });
    }
    const elegido = Number.isInteger(k) && modelos.find(m => m.k === k)
        ? modelos.find(m => m.k === k)
        // Automático: la mayor silueta entre las opciones con al menos 3 grupos (hay 3 situaciones)
        : modelos.filter(m => m.k >= 3).sort((a, b) => b.silueta - a.silueta)[0] || modelos[0];

    // Comprobación con el 30 %: cada ticket va al centro más cercano
    const { asignacion: asignTest } = asignar(XTest, nTest, elegido.C, elegido.k, d);
    const siluetaPrueba = silueta(XTest, d, asignTest, muestraTest, elegido.k);

    // Todos los tickets quedan asignados a un grupo para poder describirlos
    const grupoDe = new Int32Array(tickets.length);
    entrenamiento.forEach((fila, p) => { grupoDe[fila] = elegido.asignacion[p]; });
    prueba.forEach((fila, p) => { grupoDe[fila] = asignTest[p]; });

    let grupos = Array.from({ length: elegido.k }, (_, c) => tickets.filter((_, i) => grupoDe[i] === c))
        .map((miembros, c) => ({ original: c, miembros }))
        .filter(g => g.miembros.length > 0)
        .sort((a, b) => b.miembros.length - a.miembros.length);
    const idNuevo = new Map(grupos.map((g, i) => [g.original, i + 1]));

    const descripcion = grupos.map((g, i) => describirGrupo(i + 1, g.miembros, tickets));

    // Estabilidad: el peso de cada grupo en el 70 % y en el 30 % debería ser parecido
    const pesoTrain = new Map(), pesoTest = new Map();
    elegido.asignacion.forEach(c => pesoTrain.set(c, (pesoTrain.get(c) || 0) + 1));
    asignTest.forEach(c => pesoTest.set(c, (pesoTest.get(c) || 0) + 1));
    descripcion.forEach((g, i) => {
        const original = grupos[i].original;
        g.entrenamiento = porcentaje(pesoTrain.get(original) || 0, nTrain);
        g.prueba = porcentaje(pesoTest.get(original) || 0, nTest);
    });

    // Mapa 2D con una muestra de tickets
    const pca = componentesPrincipales(XTrain, nTrain, d, azar);
    const XTodos = construirMatriz(tickets, columnas);
    const enPrueba = new Set(prueba);
    const puntos = barajar(Array.from({ length: tickets.length }, (_, i) => i), azar).slice(0, MUESTRA_PUNTOS).map(i => {
        const [x, y] = proyectar(XTodos, i, d, pca);
        return { x: redondear(x, 3), y: redondear(y, 3), grupo: idNuevo.get(grupoDe[i]), prueba: enPrueba.has(i) };
    });

    return {
        disponible: true,
        k: elegido.k,
        automatico: !(Number.isInteger(k) && modelos.some(m => m.k === k)),
        silueta: { entrenamiento: redondear(elegido.silueta, 3), prueba: redondear(siluetaPrueba, 3) },
        evaluacion: modelos.map(m => ({ k: m.k, inercia: redondear(m.inercia, 1), silueta: redondear(m.silueta, 3) })),
        division: { entrenamiento: nTrain, prueba: nTest, total: tickets.length },
        variables: [...new Set(columnas.map(c => c.variable))],
        varianzaMapa: redondear(pca.varianzaExplicada * 100, 1),
        grupos: descripcion,
        puntos
    };
}

module.exports = { analizarGrupos, kmeans, silueta, asignar, definirColumnas, construirMatriz };
