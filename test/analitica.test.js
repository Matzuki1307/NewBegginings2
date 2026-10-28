// Pruebas de la minería de datos. Se ejecutan con:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const { crearAzar, dividir } = require('../lib/analitica/base');
const { prepararTickets } = require('../lib/analitica/datos');
const { analizarGrupos } = require('../lib/analitica/grupos');
const { analizarReglas } = require('../lib/analitica/reglas');
const { analizarRiesgo, auc, metricas } = require('../lib/analitica/riesgo');

const DIA = 86400;
const AHORA = 1_800_000_000;

// Fila como la que devuelve la consulta SQL; `sobre` cambia lo que haga falta
function fila(id, sobre = {}) {
    return {
        id, usuarioId: id, situacion: 'Maltrato intrafamiliar', departamento: 'Antioquia', genero: 'Femenino',
        tipoId: 'Cédula de ciudadanía', estado: 'Cerrado', creado: AHORA - 100 * DIA, cerrado: AHORA - 95 * DIA,
        mes: 3, diaSemana: 2, hora: 10, cantidad: null, funcionarioId: 1, horasAsignacion: 5,
        previos: 0, reaperturas: 0, calificacion: null, ...sobre
    };
}

// ===== base =====

test('dividir reparte 70 % / 30 % sin repetir ni perder tickets', () => {
    const { entrenamiento, prueba } = dividir(1000, 7);
    assert.equal(entrenamiento.length, 700);
    assert.equal(prueba.length, 300);
    const todos = new Set([...entrenamiento, ...prueba]);
    assert.equal(todos.size, 1000);
});

test('dividir es reproducible y la semilla cambia el reparto', () => {
    assert.deepEqual(dividir(500, 3), dividir(500, 3));
    assert.notDeepEqual(dividir(500, 3).prueba, dividir(500, 4).prueba);
});

test('dividir estratificado conserva la proporción de cada clase', () => {
    const clases = Array.from({ length: 1000 }, (_, i) => (i < 200 ? 1 : 0)); // 20 % de positivos
    const { entrenamiento, prueba } = dividir(1000, 1, clases);
    const positivos = lista => lista.filter(i => clases[i] === 1).length;
    assert.equal(positivos(entrenamiento), 140);
    assert.equal(positivos(prueba), 60);
});

// ===== datos =====

test('la etiqueta de demora solo se conoce cuando el plazo ya venció', () => {
    const { tickets } = prepararTickets([
        fila(1, { cerrado: AHORA - 100 * DIA + 4 * DIA }),                 // ANS 10 días, cerrado en 4: a tiempo
        fila(2, { cerrado: AHORA - 100 * DIA + 30 * DIA }),                // cerrado en 30: demora
        fila(3, { estado: 'En proceso', cerrado: null }),                  // abierto hace 100 días: demora
        fila(4, { creado: AHORA - 2 * DIA, estado: 'Pendiente', cerrado: null }), // abierto, todavía a tiempo: se desconoce
        fila(5, { creado: AHORA - 2 * DIA, cerrado: AHORA - 1 * DIA }),    // cerrado rápido pero reciente: se desconoce
        fila(6, { situacion: null })                                       // sin situación: sin meta
    ], AHORA);
    assert.deepEqual(tickets.map(t => t.etiqueta), [0, 1, 1, null, null, null]);
});

test('la congestión cuenta los tickets abiertos al momento de crear cada ticket', () => {
    const { tickets } = prepararTickets([
        fila(1, { creado: 1000, cerrado: 5000 }),
        fila(2, { creado: 2000, cerrado: 3000 }),
        fila(3, { creado: 4000, cerrado: 6000 })
    ], AHORA);
    // Al crear el 3: el 1 sigue abierto (cierra en 5000) y el 2 ya cerró (3000)
    assert.deepEqual(tickets.map(t => t.congestion), [0, 1, 1]);
});

test('la demanda del departamento cuenta solo los 7 días previos', () => {
    const { tickets } = prepararTickets([
        fila(1, { creado: 0 * DIA }),
        fila(2, { creado: 3 * DIA }),
        fila(3, { creado: 6 * DIA }),
        fila(4, { creado: 20 * DIA }),
        fila(5, { creado: 21 * DIA, departamento: 'Cauca' })
    ], AHORA);
    assert.deepEqual(tickets.map(t => t.llegadasDepto), [0, 1, 2, 0, 0]);
});

// ===== riesgo =====

test('el AUC vale 1 si separa perfecto, 0,5 si todo empata y 0 si se equivoca siempre', () => {
    assert.equal(auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1);
    assert.equal(auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5);
    assert.equal(auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]), 0);
});

test('las métricas salen bien de una matriz de confusión conocida', () => {
    // 3 vp, 1 fp, 2 vn, 1 fn
    const m = metricas([1, 1, 1, 0, 0, 0, 1], [0.9, 0.8, 0.7, 0.6, 0.2, 0.1, 0.3]);
    assert.deepEqual(m.matriz, { vp: 3, fp: 1, vn: 2, fn: 1 });
    assert.equal(m.exactitud, 0.714);
    assert.equal(m.precision, 0.75);
    assert.equal(m.exhaustividad, 0.75);
});

// Tickets donde la demora depende claramente del departamento y del responsable
function ticketsConPatron(n) {
    const azar = crearAzar(11);
    const filas = [];
    for (let i = 1; i <= n; i++) {
        const lento = azar() < 0.5;
        const duracion = lento ? 15 + azar() * 5 : 2 + azar() * 4; // ANS de 10 días
        filas.push(fila(i, {
            departamento: lento ? 'Chocó' : 'Antioquia',
            funcionarioId: lento ? 1 : 2,
            horasAsignacion: lento ? 80 : 4,
            creado: AHORA - (400 - (i % 300)) * DIA,
            cerrado: AHORA - (400 - (i % 300)) * DIA + duracion * DIA
        }));
    }
    return prepararTickets(filas, AHORA).tickets;
}

test('el modelo de riesgo aprende un patrón claro y lo comprueba con el 30 % de prueba', () => {
    const r = analizarRiesgo(ticketsConPatron(600));
    assert.equal(r.disponible, true);
    assert.equal(r.division.entrenamiento + r.division.prueba, r.division.total);
    assert.ok(Math.abs(r.division.entrenamiento / r.division.total - 0.7) < 0.01);
    assert.equal(r.base.prueba.auc, 0.5);
    for (const id of ['alCrear', 'conResponsable']) {
        const v = r.variantes[id];
        assert.ok(v.regresion.prueba.auc > 0.95, `${id}: regresión AUC ${v.regresion.prueba.auc}`);
        assert.ok(v.arbol.prueba.auc > 0.9, `${id}: árbol AUC ${v.arbol.prueba.auc}`);
    }
});

test('el análisis de riesgo es reproducible y no expone el modelo interno', () => {
    const tickets = ticketsConPatron(400);
    const a = analizarRiesgo(tickets);
    const b = analizarRiesgo(tickets);
    assert.deepEqual(a, b);
    assert.equal(a.variantes.alCrear._modelo, undefined);
});

test('los tickets abiertos vencidos se marcan y los demás reciben una probabilidad', () => {
    const base = ticketsConPatron(400);
    const { tickets: abiertos } = prepararTickets([
        fila(9001, { estado: 'En proceso', cerrado: null, creado: AHORA - 50 * DIA }),                       // vencido
        fila(9002, { estado: 'En proceso', cerrado: null, creado: AHORA - 1 * DIA, departamento: 'Chocó', funcionarioId: 1, horasAsignacion: 80 }),
        fila(9003, { estado: 'Pendiente', cerrado: null, creado: AHORA - 1 * DIA, funcionarioId: null, horasAsignacion: null })
    ], AHORA);
    const r = analizarRiesgo([...base, ...abiertos]);
    assert.equal(r.abiertos.total, 3);
    assert.equal(r.abiertos.vencidos, 1);
    assert.equal(r.vencidos[0].id, 9001);
    const riesgo = Object.fromEntries(r.enRiesgo.map(f => [f.id, f]));
    assert.equal(riesgo[9002].modelo, 'conResponsable');
    assert.equal(riesgo[9003].modelo, 'alCrear');
    assert.ok(riesgo[9002].probabilidad > 0.7, `probabilidad ${riesgo[9002].probabilidad}`);
});

test('con muy pocos tickets el riesgo explica por qué no se puede entrenar', () => {
    const r = analizarRiesgo(ticketsConPatron(30));
    assert.equal(r.disponible, false);
    assert.match(r.motivo, /Hacen falta/);
});

// ===== reglas =====

test('las reglas calculan bien soporte, confianza y lift', () => {
    // 1000 tickets: 400 de Cauca; 360 de ellos son desplazamiento. En el resto, 100 de 600 lo son.
    const filas = [];
    for (let i = 0; i < 1000; i++) {
        const cauca = i < 400;
        const desplazamiento = cauca ? i < 360 : i < 460;
        filas.push(fila(i + 1, {
            departamento: cauca ? 'Cauca' : 'Antioquia',
            situacion: desplazamiento ? 'Desplazamiento forzado' : 'Maltrato intrafamiliar'
        }));
    }
    const { tickets } = prepararTickets(filas, AHORA);
    // Se ordenan al azar para que el 70/30 no tome bloques enteros
    const mezclados = tickets.map(t => ({ t, k: Math.sin(t.id * 12.9898) })).sort((a, b) => a.k - b.k).map(x => x.t);
    const r = analizarReglas(mezclados, { minSoporte: 0.01, minConfianza: 0.5 });
    const regla = r.reglas.find(x => x.antecedente.length === 1 && x.antecedente[0].valor === 'Cauca' && x.consecuente.valor === 'Desplazamiento forzado');
    assert.ok(regla, 'debe existir Cauca ⇒ Desplazamiento');
    assert.ok(Math.abs(regla.confianza - 0.9) < 0.04, `confianza ${regla.confianza}`);
    assert.ok(Math.abs(regla.soporte - 0.36) < 0.04, `soporte ${regla.soporte}`);
    assert.ok(Math.abs(regla.lift - 0.9 / 0.46) < 0.15, `lift ${regla.lift}`);
    assert.equal(regla.estable, true);
    assert.ok(regla.prueba.casosAntecedente > 0);
});

test('las reglas no mezclan dos valores de la misma variable', () => {
    const { tickets } = prepararTickets(Array.from({ length: 300 }, (_, i) =>
        fila(i + 1, { departamento: i % 2 ? 'Cauca' : 'Chocó', mes: (i % 12) + 1 })), AHORA);
    const r = analizarReglas(tickets, { minSoporte: 0.01, minConfianza: 0.4 });
    for (const regla of r.reglas) {
        const variables = [...regla.antecedente, regla.consecuente].map(x => x.variable);
        assert.equal(new Set(variables).size, variables.length);
    }
});

// ===== grupos =====

test('los grupos separan tres perfiles muy distintos y se sostienen en la prueba', () => {
    const perfiles = [
        { situacion: 'Desplazamiento forzado', departamento: 'Norte de Santander', genero: 'Masculino', mes: 1 },
        { situacion: 'Violencia contra la mujer', departamento: 'Bogotá D.C.', genero: 'Femenino', mes: 6 },
        { situacion: 'Maltrato intrafamiliar', departamento: 'Atlántico', genero: 'Femenino', mes: 12 }
    ];
    const filas = Array.from({ length: 450 }, (_, i) => fila(i + 1, perfiles[i % 3]));
    const { tickets } = prepararTickets(filas, AHORA);
    const r = analizarGrupos(tickets, { k: 3 });
    assert.equal(r.disponible, true);
    assert.equal(r.k, 3);
    assert.equal(r.grupos.length, 3);
    assert.ok(r.grupos.every(g => g.tamano === 150), 'cada perfil debe quedar en su propio grupo');
    assert.ok(r.silueta.entrenamiento > 0.9 && r.silueta.prueba > 0.9);
    assert.equal(r.division.entrenamiento + r.division.prueba, 450);
    assert.deepEqual(analizarGrupos(tickets, { k: 3 }), r);
});

test('con pocos tickets los grupos avisan que no se pueden formar', () => {
    const { tickets } = prepararTickets([fila(1), fila(2)], AHORA);
    assert.equal(analizarGrupos(tickets).disponible, false);
});
