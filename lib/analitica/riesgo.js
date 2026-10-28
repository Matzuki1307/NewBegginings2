// Riesgo de demora: ¿este ticket va a superar la meta de cierre (ANS) de su situación?
//
// Es un problema de clasificación (demora sí / no). Todo se entrena con el 70 % de los tickets
// y se evalúa con el 30 % restante, que no se usó para entrenar. Se comparan:
//   - una línea base (decir siempre la clase más común), para saber si los modelos aportan algo;
//   - un árbol de decisión, que da reglas "si... entonces..." fáciles de leer;
//   - una regresión logística, que da una probabilidad y permite explicar qué factores pesan.
//
// Hay dos variantes, según lo que se sabe del ticket:
//   - "al crear": solo lo que se sabe cuando llega (situación, departamento, congestión...);
//   - "con responsable": lo anterior más quién lo atiende y cuánto tardó en asignarse.
// Los tickets abiertos se puntúan con la regresión logística de la variante que les corresponda.
//
// Solo se entrena con tickets cuyo plazo ya venció, así se sabe con certeza si incumplieron
// (ver `etiqueta` en datos.js).

const { crearAzar, barajar, dividir, redondear } = require('./base');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const MIN_TICKETS = 100;
const MIN_POR_CLASE = 20;
const UMBRAL = 0.5;               // probabilidad desde la cual se predice "demora"
const NIVEL_ALTO = 0.7;           // probabilidad desde la cual el riesgo es alto
const LAMBDAS = [0.001, 0.01, 0.1, 1];
const PROFUNDIDADES = [2, 3, 4, 5];
const MIN_HOJA = 30;              // un árbol no crea hojas con menos tickets que esto
const MIN_TICKETS_RESPONSABLE = 15; // un responsable tiene columna propia desde esta cantidad de tickets
const ITERACIONES = 250;
const TASA_APRENDIZAJE = 0.05;
const REPETICIONES_PERMUTACION = 5;
const MAX_TICKETS_LISTA = 150;

// ===== Variables =====

// Convierte las características de un ticket en números. Las categorías pasan a columnas 0/1 y
// los números se estandarizan (media 0, desviación 1) con los datos de entrenamiento.
//   texto(activa, umbral): cómo se lee una condición del árbol sobre esta columna
//   motivo: cómo se nombra la columna cuando explica el riesgo de un ticket concreto
function columnasAlCrear(entrenamiento) {
    const columnas = [];

    const categoria = (variable, extraer, motivo = valor => `${variable}: ${valor}`) => {
        const valores = [...new Set(entrenamiento.map(t => extraer(t) ?? 'Sin dato'))].sort();
        for (const valor of valores) {
            columnas.push({
                variable, valor, tipo: 'binaria',
                valorDe: t => ((extraer(t) ?? 'Sin dato') === valor ? 1 : 0),
                texto: (activa) => `${variable}${activa ? ' = ' : ' ≠ '}${valor}`,
                motivo: motivo(valor)
            });
        }
    };
    categoria('Situación', t => t.situacion);
    categoria('Departamento', t => t.departamento);
    categoria('Género', t => t.genero);
    categoria('Documento', t => t.tipoId);
    categoria('Horario', t => t.franja);
    categoria('Mes', t => MESES[t.mes - 1]);
    columnas.push({
        variable: 'Fin de semana', valor: 'Sí', tipo: 'binaria', valorDe: t => (t.finSemana ? 1 : 0),
        texto: (activa) => (activa ? 'Se creó en fin de semana' : 'Se creó entre semana'),
        motivo: 'Creado en fin de semana'
    });

    // Numéricas. Las de cola larga se pasan por log(1 + x) para que los valores extremos no dominen.
    anadirNumerica(columnas, entrenamiento, {
        variable: 'Congestión al crear', valorDe: t => t.congestion, inversa: z => z,
        texto: (activa, u) => (activa ? `Había más de ${redondear(u, 0)} tickets abiertos al crearse` : `Había ${redondear(u, 0)} tickets abiertos o menos al crearse`),
        motivo: 'Muchos tickets abiertos al crearse'
    });
    anadirNumerica(columnas, entrenamiento, {
        variable: 'Demanda reciente en el departamento', valorDe: t => Math.log1p(t.llegadasDepto), inversa: z => Math.expm1(z),
        texto: (activa, u) => (activa ? `Su departamento recibió más de ${redondear(u, 0)} tickets en los 7 días previos` : `Su departamento recibió ${redondear(u, 0)} tickets o menos en los 7 días previos`),
        motivo: 'Mucha demanda reciente en su departamento'
    });
    anadirNumerica(columnas, entrenamiento, {
        variable: 'Solicitudes previas de la persona', valorDe: t => Math.log1p(t.previos), inversa: z => Math.expm1(z),
        texto: (activa) => (activa ? 'La persona ya había pedido ayuda antes' : 'Es su primera solicitud'),
        motivo: 'La persona ya había pedido ayuda antes'
    });
    return columnas;
}

function anadirNumerica(columnas, entrenamiento, { variable, valorDe, inversa, texto, motivo }) {
    const valores = entrenamiento.map(valorDe);
    const media = valores.reduce((s, x) => s + x, 0) / valores.length;
    const desv = Math.sqrt(valores.reduce((s, x) => s + (x - media) ** 2, 0) / valores.length) || 1;
    columnas.push({ variable, valor: null, tipo: 'numerica', valorDe, media, desv, inversa, texto, motivo });
}

// Variante "con responsable": además del responsable (una columna por funcionario con
// suficientes tickets) se usa cuánto tardó en asignarse el ticket
function columnasConResponsable(entrenamiento) {
    const columnas = columnasAlCrear(entrenamiento);

    const porResponsable = new Map();
    for (const t of entrenamiento) {
        if (t.funcionarioId !== null) porResponsable.set(t.funcionarioId, (porResponsable.get(t.funcionarioId) || 0) + 1);
    }
    const responsables = [...porResponsable].filter(([, n]) => n >= MIN_TICKETS_RESPONSABLE).map(([id]) => id).sort((a, b) => a - b);
    for (const id of responsables) {
        columnas.push({
            variable: 'Responsable asignado', valor: `Funcionario n.º ${id}`, tipo: 'binaria',
            valorDe: t => (t.funcionarioId === id ? 1 : 0),
            texto: (activa) => `Responsable ${activa ? '=' : '≠'} funcionario n.º ${id}`,
            motivo: 'Responsable con historial de demoras'
        });
    }

    // Si no se conoce el momento de asignación se usa el valor típico (la mediana del entrenamiento)
    const conocidas = entrenamiento.map(t => t.horasAsignacion).filter(h => h !== null).sort((a, b) => a - b);
    const tipica = conocidas.length ? conocidas[Math.floor(conocidas.length / 2)] : 0;
    anadirNumerica(columnas, entrenamiento, {
        variable: 'Horas hasta la asignación', valorDe: t => Math.log1p(Math.max(0, t.horasAsignacion ?? tipica)), inversa: z => Math.expm1(z),
        texto: (activa, u) => (activa ? `La asignación tardó más de ${redondear(u, 0)} horas` : `La asignación tardó ${redondear(u, 0)} horas o menos`),
        motivo: 'Asignación lenta'
    });
    return columnas;
}

function codificar(tickets, columnas) {
    const d = columnas.length;
    const X = new Float64Array(tickets.length * d);
    tickets.forEach((t, i) => {
        columnas.forEach((c, j) => {
            const v = c.valorDe(t);
            X[i * d + j] = c.tipo === 'numerica' ? (v - c.media) / c.desv : v;
        });
    });
    return X;
}

// ===== Regresión logística =====

const sigmoide = z => 1 / (1 + Math.exp(-z));

// Ajusta pesos para minimizar el error logístico más una penalización L2 (lambda) que evita
// que los pesos crezcan de más. Se optimiza con Adam, que es un descenso de gradiente con paso adaptativo.
function entrenarLogistica(X, y, n, d, lambda) {
    const w = new Float64Array(d);
    let b = 0;
    const mw = new Float64Array(d), vw = new Float64Array(d);
    let mb = 0, vb = 0;
    const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
    const gw = new Float64Array(d);

    for (let it = 1; it <= ITERACIONES; it++) {
        gw.fill(0);
        let gb = 0;
        for (let i = 0; i < n; i++) {
            let z = b;
            const fila = i * d;
            for (let j = 0; j < d; j++) z += w[j] * X[fila + j];
            const error = sigmoide(z) - y[i];
            gb += error;
            for (let j = 0; j < d; j++) gw[j] += error * X[fila + j];
        }
        for (let j = 0; j < d; j++) gw[j] = gw[j] / n + lambda * w[j];
        gb /= n;

        const c1 = 1 - beta1 ** it, c2 = 1 - beta2 ** it;
        for (let j = 0; j < d; j++) {
            mw[j] = beta1 * mw[j] + (1 - beta1) * gw[j];
            vw[j] = beta2 * vw[j] + (1 - beta2) * gw[j] * gw[j];
            w[j] -= TASA_APRENDIZAJE * (mw[j] / c1) / (Math.sqrt(vw[j] / c2) + eps);
        }
        mb = beta1 * mb + (1 - beta1) * gb;
        vb = beta2 * vb + (1 - beta2) * gb * gb;
        b -= TASA_APRENDIZAJE * (mb / c1) / (Math.sqrt(vb / c2) + eps);
    }
    return { w, b, lambda };
}

function predecirLogistica(modelo, X, n, d) {
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let z = modelo.b;
        for (let j = 0; j < d; j++) z += modelo.w[j] * X[i * d + j];
        p[i] = sigmoide(z);
    }
    return p;
}

// ===== Árbol de decisión (CART con impureza de Gini) =====

function gini(positivos, total) {
    if (total === 0) return 0;
    const p = positivos / total;
    return 2 * p * (1 - p);
}

function entrenarArbol(X, y, d, columnas, profundidadMax) {
    const binaria = columnas.map(c => c.tipo === 'binaria');

    function mejorCorte(filas) {
        const n = filas.length;
        let positivos = 0;
        for (const i of filas) positivos += y[i];
        const impurezaPadre = gini(positivos, n);
        let mejor = null;

        const probar = (j, umbral, nIzq, posIzq) => {
            const nDer = n - nIzq;
            if (nIzq < MIN_HOJA || nDer < MIN_HOJA) return;
            const ganancia = impurezaPadre - (nIzq / n) * gini(posIzq, nIzq) - (nDer / n) * gini(positivos - posIzq, nDer);
            if (!mejor || ganancia > mejor.ganancia) mejor = { j, umbral, ganancia };
        };

        for (let j = 0; j < d; j++) {
            if (binaria[j]) {
                let nUno = 0, posUno = 0;
                for (const i of filas) if (X[i * d + j] > 0.5) { nUno++; posUno += y[i]; }
                probar(j, 0.5, n - nUno, positivos - posUno);
            } else {
                const ordenadas = filas.slice().sort((a, b) => X[a * d + j] - X[b * d + j]);
                let nIzq = 0, posIzq = 0;
                for (let k = 0; k < n - 1; k++) {
                    nIzq++;
                    posIzq += y[ordenadas[k]];
                    const actual = X[ordenadas[k] * d + j], siguiente = X[ordenadas[k + 1] * d + j];
                    if (siguiente > actual) probar(j, (actual + siguiente) / 2, nIzq, posIzq);
                }
            }
        }
        return mejor;
    }

    function construir(filas, profundidad) {
        const n = filas.length;
        let positivos = 0;
        for (const i of filas) positivos += y[i];
        // Con suavizado de Laplace para que ninguna hoja prediga 0 % o 100 % exactos
        const hoja = { hoja: true, n, positivos, p: (positivos + 1) / (n + 2) };
        if (profundidad >= profundidadMax || positivos === 0 || positivos === n) return hoja;

        const corte = mejorCorte(filas);
        if (!corte || corte.ganancia < 1e-4) return hoja;

        const izq = [], der = [];
        for (const i of filas) (X[i * d + corte.j] > corte.umbral ? der : izq).push(i);
        return {
            hoja: false, n, positivos, columna: corte.j, umbral: corte.umbral,
            izq: construir(izq, profundidad + 1), der: construir(der, profundidad + 1)
        };
    }

    return construir(Array.from({ length: y.length }, (_, i) => i), 0);
}

function hojaDe(arbol, X, d, i) {
    let nodo = arbol;
    while (!nodo.hoja) nodo = X[i * d + nodo.columna] > nodo.umbral ? nodo.der : nodo.izq;
    return nodo;
}

function predecirArbol(arbol, X, n, d) {
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) p[i] = hojaDe(arbol, X, d, i).p;
    return p;
}

// Un camino del árbol puede preguntar varias veces por lo mismo ("más de 46 horas" y luego "más de 179").
// Se deja solo lo que no es redundante: la cota más estricta de cada número y, si ya se sabe que
// la situación (o el departamento...) es una, se omiten las negaciones de las demás.
function simplificarCondiciones(pasos, columnas) {
    const inferior = new Map(), superior = new Map(); // columna numérica -> paso con la cota más estricta
    const afirmadas = new Set();                      // variables con un "es igual a" en el camino
    for (const paso of pasos) {
        const c = columnas[paso.columna];
        if (c.tipo === 'numerica') {
            const mapa = paso.activa ? inferior : superior;
            const actual = mapa.get(paso.columna);
            if (!actual || (paso.activa ? paso.original > actual.original : paso.original < actual.original)) mapa.set(paso.columna, paso);
        } else if (paso.activa) {
            afirmadas.add(c.variable);
        }
    }
    return pasos.filter(paso => {
        const c = columnas[paso.columna];
        if (c.tipo === 'numerica') return (paso.activa ? inferior : superior).get(paso.columna) === paso;
        return paso.activa || !afirmadas.has(c.variable);
    }).map(paso => columnas[paso.columna].texto(paso.activa, paso.original));
}

// Las hojas del árbol como reglas legibles, con lo que se observó en entrenamiento y en prueba
function reglasDelArbol(arbol, columnas, XTest, yTest, d) {
    const hojas = [];
    (function recorrer(nodo, pasos) {
        if (nodo.hoja) { hojas.push({ nodo, condiciones: simplificarCondiciones(pasos, columnas) }); return; }
        const c = columnas[nodo.columna];
        const original = c.tipo === 'numerica' ? c.inversa(nodo.umbral * c.desv + c.media) : null;
        recorrer(nodo.izq, [...pasos, { columna: nodo.columna, activa: false, original }]);
        recorrer(nodo.der, [...pasos, { columna: nodo.columna, activa: true, original }]);
    })(arbol, []);

    // Qué pasó con los tickets de prueba que caen en cada hoja
    const prueba = new Map(hojas.map(h => [h.nodo, { n: 0, positivos: 0 }]));
    for (let i = 0; i < yTest.length; i++) {
        const acumulado = prueba.get(hojaDe(arbol, XTest, d, i));
        acumulado.n++;
        acumulado.positivos += yTest[i];
    }

    return hojas.map(({ nodo, condiciones }) => ({
        condiciones,
        probabilidad: redondear(nodo.positivos / nodo.n, 3),
        casos: nodo.n,
        prueba: {
            casos: prueba.get(nodo).n,
            probabilidad: prueba.get(nodo).n ? redondear(prueba.get(nodo).positivos / prueba.get(nodo).n, 3) : null
        }
    })).sort((a, b) => b.probabilidad - a.probabilidad);
}

// ===== Métricas =====

// Área bajo la curva ROC: la probabilidad de que un ticket con demora reciba una puntuación
// más alta que uno sin demora (0,5 = azar, 1 = perfecto). Se calcula con los rangos de las puntuaciones.
function auc(y, p) {
    const n = y.length;
    const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a] - p[b]);
    let sumaRangos = 0, positivos = 0;
    for (let i = 0; i < n;) {
        let j = i;
        while (j + 1 < n && p[orden[j + 1]] === p[orden[i]]) j++;
        const rango = (i + j) / 2 + 1; // los empates comparten el rango promedio
        for (let k = i; k <= j; k++) if (y[orden[k]] === 1) { sumaRangos += rango; positivos++; }
        i = j + 1;
    }
    const negativos = n - positivos;
    return positivos === 0 || negativos === 0 ? null : (sumaRangos - positivos * (positivos + 1) / 2) / (positivos * negativos);
}

function metricas(y, p, umbral = UMBRAL) {
    let vp = 0, fp = 0, vn = 0, fn = 0;
    for (let i = 0; i < y.length; i++) {
        const prediccion = p[i] >= umbral ? 1 : 0;
        if (prediccion === 1) { if (y[i] === 1) vp++; else fp++; } else if (y[i] === 1) fn++; else vn++;
    }
    const precision = vp + fp ? vp / (vp + fp) : null;
    const exhaustividad = vp + fn ? vp / (vp + fn) : null;
    const especificidad = vn + fp ? vn / (vn + fp) : null;
    const f1 = precision !== null && exhaustividad !== null && precision + exhaustividad > 0
        ? (2 * precision * exhaustividad) / (precision + exhaustividad) : null;
    return {
        exactitud: redondear((vp + vn) / y.length, 3),
        // Promedio de acertar los casos con demora y los que no: 0,5 equivale a no saber nada
        exactitudBalanceada: exhaustividad !== null && especificidad !== null ? redondear((exhaustividad + especificidad) / 2, 3) : null,
        precision: redondear(precision, 3),
        exhaustividad: redondear(exhaustividad, 3),
        f1: redondear(f1, 3),
        auc: redondear(auc(y, p), 3),
        matriz: { vp, fp, vn, fn }
    };
}

// Puntos de la curva ROC (tasa de falsos positivos contra tasa de verdaderos positivos)
function curvaRoc(y, p, puntos = 30) {
    let positivos = 0;
    for (const v of y) positivos += v;
    const negativos = y.length - positivos;
    const resultado = [{ fpr: 0, tpr: 0 }];
    for (let k = 1; k < puntos; k++) {
        const umbral = 1 - k / puntos;
        let vp = 0, fp = 0;
        for (let i = 0; i < y.length; i++) if (p[i] >= umbral) { if (y[i] === 1) vp++; else fp++; }
        resultado.push({ fpr: redondear(fp / negativos, 3), tpr: redondear(vp / positivos, 3) });
    }
    resultado.push({ fpr: 1, tpr: 1 });
    return resultado;
}

// Comparación de las probabilidades prometidas con lo que ocurrió, por nivel de riesgo
function porNivel(y, p) {
    const niveles = [
        { nombre: 'Alto', desde: NIVEL_ALTO, hasta: 1.01 },
        { nombre: 'Medio', desde: UMBRAL, hasta: NIVEL_ALTO },
        { nombre: 'Bajo', desde: 0, hasta: UMBRAL }
    ];
    return niveles.map(({ nombre, desde, hasta }) => {
        let n = 0, positivos = 0;
        for (let i = 0; i < y.length; i++) if (p[i] >= desde && p[i] < hasta) { n++; positivos += y[i]; }
        return { nivel: nombre, tickets: n, incumplen: n ? redondear((positivos / n) * 100, 1) : null };
    });
}

// ===== Interpretación del modelo =====

// Cuánto empeora el AUC de prueba si se desordenan los valores de una variable: cuanto más
// empeora, más depende el modelo de ella
function importanciaVariables(modelo, XTest, yTest, d, columnas, azar) {
    const n = yTest.length;
    const base = auc(yTest, predecirLogistica(modelo, XTest, n, d));
    const variables = [...new Set(columnas.map(c => c.variable))];
    const resultado = variables.map(variable => {
        const indices = columnas.map((c, j) => (c.variable === variable ? j : -1)).filter(j => j >= 0);
        let suma = 0;
        for (let r = 0; r < REPETICIONES_PERMUTACION; r++) {
            const orden = barajar(Array.from({ length: n }, (_, i) => i), azar);
            const Xp = XTest.slice();
            for (let i = 0; i < n; i++) for (const j of indices) Xp[i * d + j] = XTest[orden[i] * d + j];
            suma += auc(yTest, predecirLogistica(modelo, Xp, n, d));
        }
        return { variable, importancia: redondear(base - suma / REPETICIONES_PERMUTACION, 4) };
    });
    return resultado.sort((a, b) => b.importancia - a.importancia);
}

// Cuántas veces cambian las probabilidades (odds) si el ticket tiene cada característica.
// Binarias: de no tenerla a tenerla. Numéricas: por cada desviación estándar más.
function efectosDelModelo(modelo, columnas) {
    return columnas.map((c, j) => ({
        variable: c.variable,
        valor: c.valor,
        tipo: c.tipo,
        razon: redondear(Math.exp(modelo.w[j]), 2),
        peso: redondear(modelo.w[j], 3)
    })).filter(e => Number.isFinite(e.peso)).sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso));
}

// Qué características de un ticket empujan más hacia la demora (hasta dos)
function motivosDe(modelo, columnas, X, i, d) {
    const aportes = new Map();
    columnas.forEach((c, j) => {
        const x = X[i * d + j];
        if (c.tipo === 'binaria' && x === 0) return;
        const aporte = modelo.w[j] * x;
        if (aporte <= 0) return;
        aportes.set(c.motivo, (aportes.get(c.motivo) || 0) + aporte);
    });
    return [...aportes].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([motivo]) => motivo);
}

// ===== Entrenamiento de una variante =====

const submatriz = (X, d, filas) => {
    const S = new Float64Array(filas.length * d);
    filas.forEach((f, i) => S.set(X.subarray(f * d, f * d + d), i * d));
    return S;
};

const cuentaPositivos = y => y.reduce((s, v) => s + v, 0);

// Entrena y evalúa los dos modelos de una variante con la partición 70/30 recibida.
//   etiquetados: tickets con demora conocida; y: su etiqueta; entrenamiento/prueba: índices en `etiquetados`
function entrenarVariante({ nombre, descripcion, definir, incluye }, etiquetados, y, entrenamiento, prueba, semilla) {
    const filasTrain = entrenamiento.filter(i => incluye(etiquetados[i]));
    const filasTest = prueba.filter(i => incluye(etiquetados[i]));
    const yTrain = Float64Array.from(filasTrain, i => y[i]);
    const yTest = Float64Array.from(filasTest, i => y[i]);
    const nTrain = yTrain.length, nTest = yTest.length;

    const suficiente = (v, n) => n >= MIN_TICKETS * 0.7 && cuentaPositivos(v) >= MIN_POR_CLASE * 0.7 && n - cuentaPositivos(v) >= MIN_POR_CLASE * 0.7;
    if (!suficiente(yTrain, nTrain) || nTest < 20 || cuentaPositivos(yTest) === 0 || cuentaPositivos(yTest) === nTest) {
        return { nombre, disponible: false, motivo: 'No hay suficientes tickets con esta información para entrenar y probar.' };
    }

    const dTrain = filasTrain.map(i => etiquetados[i]);
    const dTest = filasTest.map(i => etiquetados[i]);
    const columnas = definir(dTrain);
    const d = columnas.length;
    const XTrain = codificar(dTrain, columnas);
    const XTest = codificar(dTest, columnas);

    // Elección de hiperparámetros: solo con el entrenamiento (la prueba no se toca).
    // Se aparta una quinta parte del entrenamiento para comparar opciones.
    const interna = dividir(nTrain, (semilla ?? 2026) + 7, Array.from(yTrain));
    const XFit = submatriz(XTrain, d, interna.entrenamiento), XVal = submatriz(XTrain, d, interna.prueba);
    const yFit = Float64Array.from(interna.entrenamiento, i => yTrain[i]);
    const yVal = Float64Array.from(interna.prueba, i => yTrain[i]);

    const candidatosLogistica = LAMBDAS.map(lambda => {
        const modelo = entrenarLogistica(XFit, yFit, yFit.length, d, lambda);
        return { lambda, auc: auc(yVal, predecirLogistica(modelo, XVal, yVal.length, d)) };
    });
    const lambda = candidatosLogistica.slice().sort((a, b) => b.auc - a.auc)[0].lambda;

    const candidatosArbol = PROFUNDIDADES.map(profundidad => {
        const arbol = entrenarArbol(XFit, yFit, d, columnas, profundidad);
        return { profundidad, auc: auc(yVal, predecirArbol(arbol, XVal, yVal.length, d)) };
    });
    // A igual desempeño se prefiere el árbol más simple
    const mejorAucArbol = Math.max(...candidatosArbol.map(c => c.auc));
    const profundidad = candidatosArbol.find(c => c.auc >= mejorAucArbol - 0.002).profundidad;

    // Entrenamiento final con todo el 70 %
    const logistica = entrenarLogistica(XTrain, yTrain, nTrain, d, lambda);
    const arbol = entrenarArbol(XTrain, yTrain, d, columnas, profundidad);
    const pLogTrain = predecirLogistica(logistica, XTrain, nTrain, d);
    const pLogTest = predecirLogistica(logistica, XTest, nTest, d);
    const pArbTrain = predecirArbol(arbol, XTrain, nTrain, d);
    const pArbTest = predecirArbol(arbol, XTest, nTest, d);

    const azar = crearAzar((semilla ?? 2026) + 13);
    return {
        nombre,
        descripcion,
        disponible: true,
        variables: [...new Set(columnas.map(c => c.variable))],
        division: { entrenamiento: nTrain, prueba: nTest },
        eleccion: {
            lambdas: candidatosLogistica.slice().sort((a, b) => a.lambda - b.lambda).map(c => ({ lambda: c.lambda, auc: redondear(c.auc, 3) })),
            profundidades: candidatosArbol.map(c => ({ profundidad: c.profundidad, auc: redondear(c.auc, 3) }))
        },
        regresion: {
            entrenamiento: metricas(yTrain, pLogTrain),
            prueba: metricas(yTest, pLogTest),
            roc: curvaRoc(yTest, pLogTest),
            niveles: porNivel(yTest, pLogTest),
            lambda
        },
        arbol: {
            entrenamiento: metricas(yTrain, pArbTrain),
            prueba: metricas(yTest, pArbTest),
            roc: curvaRoc(yTest, pArbTest),
            profundidad,
            reglas: reglasDelArbol(arbol, columnas, XTest, yTest, d)
        },
        importancia: importanciaVariables(logistica, XTest, yTest, d, columnas, azar),
        efectos: efectosDelModelo(logistica, columnas),
        // Para puntuar tickets nuevos (no se envía al navegador)
        _modelo: { columnas, d, logistica }
    };
}

const VARIANTES = [
    {
        id: 'alCrear',
        nombre: 'Al crear el ticket',
        descripcion: 'Solo usa lo que se sabe cuando llega el caso: situación, departamento, género, documento, fecha y hora, congestión del sistema, demanda reciente en el departamento y solicitudes previas de la persona.',
        definir: columnasAlCrear,
        incluye: () => true
    },
    {
        id: 'conResponsable',
        nombre: 'Con responsable asignado',
        descripcion: 'Suma a lo anterior quién atiende el ticket y cuánto tardó en asignarse. Se entrena solo con tickets que tienen responsable.',
        definir: columnasConResponsable,
        incluye: t => t.funcionarioId !== null
    }
];

// ===== Análisis completo =====

function analizarRiesgo(tickets, { semilla } = {}) {
    const conMeta = tickets.filter(t => t.ans !== null);
    const etiquetados = tickets.filter(t => t.etiqueta !== null);
    const positivos = etiquetados.filter(t => t.etiqueta === 1).length;
    const exclusiones = {
        sinSituacion: tickets.length - conMeta.length,
        dentroDePlazo: conMeta.filter(t => t.etiqueta === null && t.edadDias <= t.ans).length,
        sinFechaCierre: conMeta.filter(t => t.etiqueta === null && t.edadDias > t.ans).length
    };

    if (etiquetados.length < MIN_TICKETS || positivos < MIN_POR_CLASE || etiquetados.length - positivos < MIN_POR_CLASE) {
        return {
            disponible: false,
            motivo: `Hacen falta al menos ${MIN_TICKETS} tickets con plazo vencido y ${MIN_POR_CLASE} de cada clase (con y sin demora) para entrenar el modelo; hay ${etiquetados.length} (${positivos} con demora).`
        };
    }

    // 70 % entrenamiento, 30 % prueba, conservando en cada parte la proporción de demoras.
    // Las dos variantes usan esta misma partición.
    const y = Float64Array.from(etiquetados, t => t.etiqueta);
    const { entrenamiento, prueba } = dividir(etiquetados.length, semilla, etiquetados.map(t => t.etiqueta));
    const yTrain = Float64Array.from(entrenamiento, i => y[i]);
    const yTest = Float64Array.from(prueba, i => y[i]);

    const variantes = {};
    for (const definicion of VARIANTES) {
        variantes[definicion.id] = entrenarVariante(definicion, etiquetados, y, entrenamiento, prueba, semilla);
    }

    // Línea base: predecir siempre la clase más común del entrenamiento
    const prevalenciaTrain = cuentaPositivos(yTrain) / yTrain.length;
    const claseBase = prevalenciaTrain >= 0.5 ? 1 : 0;
    const base = {
        entrenamiento: metricas(yTrain, new Float64Array(yTrain.length).fill(prevalenciaTrain), claseBase ? 0 : 1.01),
        prueba: metricas(yTest, new Float64Array(yTest.length).fill(prevalenciaTrain), claseBase ? 0 : 1.01),
        claseBase
    };

    // ----- Puntuación de los tickets abiertos con la regresión logística de su variante -----
    const alCrear = variantes.alCrear;
    const conResponsable = variantes.conResponsable;
    const filas = tickets.filter(t => t.abierto).map(t => {
        const vencido = t.ans !== null && t.edadDias > t.ans;
        const fila = {
            id: t.id,
            situacion: t.situacion,
            departamento: t.departamento,
            estado: t.estado,
            edadDias: redondear(t.edadDias, 1),
            ans: t.ans,
            diasRestantes: t.ans === null ? null : redondear(t.ans - t.edadDias, 1),
            probabilidad: vencido ? 1 : null,
            nivel: t.ans === null ? 'Sin meta' : vencido ? 'Vencido' : null,
            modelo: null,
            motivos: []
        };
        if (t.ans === null || vencido) return fila;

        // El modelo con responsable solo se aplica a tickets que ya lo tienen
        const variante = t.funcionarioId !== null && conResponsable.disponible ? conResponsable : alCrear;
        if (!variante.disponible) return fila;
        const { columnas, d, logistica } = variante._modelo;
        const X = codificar([t], columnas);
        const probabilidad = predecirLogistica(logistica, X, 1, d)[0];
        fila.probabilidad = redondear(probabilidad, 3);
        fila.nivel = probabilidad >= NIVEL_ALTO ? 'Alto' : probabilidad >= UMBRAL ? 'Medio' : 'Bajo';
        fila.modelo = variante === conResponsable ? 'conResponsable' : 'alCrear';
        fila.motivos = motivosDe(logistica, columnas, X, 0, d);
        return fila;
    });
    const contar = nivel => filas.filter(f => f.nivel === nivel).length;
    const vencidos = filas.filter(f => f.nivel === 'Vencido').sort((a, b) => a.diasRestantes - b.diasRestantes);
    const enRiesgo = filas.filter(f => ['Alto', 'Medio', 'Bajo'].includes(f.nivel))
        .sort((a, b) => b.probabilidad - a.probabilidad || a.diasRestantes - b.diasRestantes);

    // El modelo interno no viaja al navegador
    for (const v of Object.values(variantes)) delete v._modelo;

    return {
        disponible: true,
        objetivo: {
            descripcion: 'El ticket se cierra después de la meta (ANS) de su situación',
            metas: [...new Map(conMeta.map(t => [t.situacion, t.ans]))].map(([situacion, dias]) => ({ situacion, dias })),
            demoras: positivos,
            porcentajeDemoras: redondear((positivos / etiquetados.length) * 100, 1)
        },
        division: {
            total: etiquetados.length, entrenamiento: entrenamiento.length, prueba: prueba.length,
            demorasEntrenamiento: redondear(prevalenciaTrain * 100, 1),
            demorasPrueba: redondear((cuentaPositivos(yTest) / yTest.length) * 100, 1)
        },
        exclusiones,
        base,
        variantes,
        umbrales: { medio: UMBRAL, alto: NIVEL_ALTO },
        abiertos: {
            total: filas.length,
            vencidos: contar('Vencido'),
            alto: contar('Alto'),
            medio: contar('Medio'),
            bajo: contar('Bajo'),
            sinMeta: contar('Sin meta')
        },
        vencidos: vencidos.slice(0, MAX_TICKETS_LISTA),
        enRiesgo: enRiesgo.slice(0, MAX_TICKETS_LISTA)
    };
}

module.exports = {
    analizarRiesgo, columnasAlCrear, columnasConResponsable, codificar, entrenarLogistica, predecirLogistica,
    entrenarArbol, predecirArbol, metricas, auc, curvaRoc
};
