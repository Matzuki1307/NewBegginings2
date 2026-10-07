// Genera un dataset sintético y realista para demostrar la plataforma y practicar minería de datos.
//
// Uso:  npm run seed:demo                     (6000 tickets, semilla 2026)
//       npm run seed:demo -- --tickets=10000 --semilla=7
//       npm run seed:demo -- --solo-limpiar   (borra los datos demo y no genera nada)
//
// Usa la DATABASE_URL del entorno o del archivo .env. Todo lo que crea pertenece a cuentas
// @demo.newbeginnings.co, así que volver a ejecutarlo reemplaza los datos demo sin tocar los reales.
// Las personas son ficticias: nombres, documentos y teléfonos se generan al azar.
//
// Patrones incluidos a propósito (para descubrirlos con minería de datos):
//  - Desplazamiento concentrado en departamentos de conflicto; violencia y maltrato según población.
//  - Eventos de desplazamiento masivo (Catatumbo, Cauca, Chocó) que generan picos y congestión.
//  - Estacionalidad: más maltrato intrafamiliar en diciembre/enero, y más violencia los fines de semana y de noche.
//  - Crecimiento del uso de la plataforma con el tiempo.
//  - Género y tipo de documento distintos por situación; migrantes con PPT en zonas de frontera.
//  - Funcionarios especializados por situación y con distinta eficiencia (tiempos de cierre).
//  - Satisfacción que baja con el tiempo de resolución y las reaperturas, y sube con el acompañamiento.
//  - Personas que vuelven a pedir ayuda (recurrencia), sobre todo por maltrato intrafamiliar.

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, initDb, transaccion } = require('../DB/db');

const DOMINIO = 'demo.newbeginnings.co';
const PASSWORD_DEMO = 'Demo1234';
const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [clave, valor] = a.replace(/^--/, '').split('=');
    return [clave, valor ?? true];
}));
const TOTAL_TICKETS = Number(args.tickets || 6000);
const SEMILLA = Number(args.semilla || 2026);
const AHORA = Date.now();
const INICIO = AHORA - 730 * DIA; // dos años de historia

// ===================== Azar reproducible =====================

function mulberry32(semilla) {
    let a = semilla;
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const azar = mulberry32(SEMILLA);
const entre = (min, max) => min + Math.floor(azar() * (max - min + 1));
const elegir = lista => lista[Math.floor(azar() * lista.length)];
const probable = p => azar() < p;
function ponderado(pesos) {
    const entradas = Object.entries(pesos);
    let r = azar() * entradas.reduce((s, [, p]) => s + p, 0);
    for (const [clave, peso] of entradas) {
        if ((r -= peso) <= 0) return clave;
    }
    return entradas[entradas.length - 1][0];
}
function normal() {
    const u = 1 - azar(), v = azar();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const lognormal = (mediana, sigma) => mediana * Math.exp(sigma * normal());
const limitar = (x, min, max) => Math.max(min, Math.min(max, x));

// Fecha en hora de Colombia (UTC-5) a partir de un día y una hora local
function fechaColombia(diaMs, horaLocal, minuto) {
    const d = new Date(diaMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), horaLocal + 5, minuto);
}
const mesColombia = ms => new Date(ms - 5 * HORA).getUTCMonth() + 1;
const diaSemanaColombia = ms => new Date(ms - 5 * HORA).getUTCDay(); // 0 domingo

// ===================== Datos de referencia =====================

const NOMBRES_F = ['María', 'Luz', 'Ana', 'Diana', 'Sandra', 'Paola', 'Carolina', 'Andrea', 'Yolanda', 'Gloria', 'Marta',
    'Claudia', 'Leidy', 'Yuliana', 'Daniela', 'Valentina', 'Camila', 'Laura', 'Natalia', 'Jenny', 'Viviana', 'Liliana',
    'Rosa', 'Ángela', 'Mónica', 'Erika', 'Johana', 'Yesenia', 'Marcela', 'Alejandra', 'Isabel', 'Patricia', 'Carmen',
    'Esperanza', 'Dora', 'Nelly', 'Luisa', 'Juliana', 'Tatiana', 'Mayerly', 'Karen', 'Lorena', 'Adriana', 'Beatriz',
    'Yeimy', 'Dayana', 'Sofía', 'Mariana', 'Gabriela', 'Nancy', 'Fanny', 'Elena', 'Milena', 'Yaneth', 'Rocío', 'Stella'];
const NOMBRES_M = ['José', 'Luis', 'Carlos', 'Juan', 'Jorge', 'Andrés', 'Jhon', 'Diego', 'Óscar', 'Édgar', 'Fabio',
    'Jairo', 'William', 'Wilson', 'Fredy', 'Hernán', 'Álvaro', 'Miguel', 'Santiago', 'Sebastián', 'Camilo', 'Felipe',
    'Daniel', 'David', 'Alejandro', 'Julián', 'Cristian', 'Brayan', 'Kevin', 'Esteban', 'Mauricio', 'Ricardo', 'Hugo',
    'Pedro', 'Rafael', 'Manuel', 'Gustavo', 'Orlando', 'Rubén', 'Arley', 'Yeison', 'Wilmer', 'Duván', 'Néstor',
    'Héctor', 'Germán', 'Ramiro', 'Alonso', 'Elkin', 'Jhonatan', 'Samuel', 'Mateo', 'Nicolás', 'Tomás', 'Iván', 'Gilberto'];
const APELLIDOS = ['Rodríguez', 'Gómez', 'González', 'Martínez', 'García', 'López', 'Hernández', 'Sánchez', 'Ramírez',
    'Pérez', 'Díaz', 'Muñoz', 'Rojas', 'Moreno', 'Jiménez', 'Vargas', 'Castro', 'Gutiérrez', 'Ortiz', 'Álvarez',
    'Torres', 'Ruiz', 'Suárez', 'Romero', 'Herrera', 'Valencia', 'Quintero', 'Restrepo', 'Mosquera', 'Palacios',
    'Cuesta', 'Rentería', 'Córdoba', 'Murillo', 'Mena', 'Hinestroza', 'Arboleda', 'Cárdenas', 'Mejía', 'Ospina',
    'Giraldo', 'Zapata', 'Cardona', 'Montoya', 'Salazar', 'Arango', 'Bedoya', 'Correa', 'Guerrero', 'Bolaños',
    'Rosero', 'Benavides', 'Chamorro', 'Pantoja', 'Ibarra', 'Caicedo', 'Ortega', 'Aguilar', 'Ramos', 'Peña',
    'Medina', 'Castillo', 'Navarro', 'Silva', 'Contreras', 'Pabón', 'Ascanio', 'Sepúlveda', 'Quintana', 'Barrios',
    'Cuéllar', 'Polo', 'Escobar', 'Acosta', 'Mendoza', 'Villamizar', 'Jaimes', 'Carrillo', 'Becerra', 'Vergara'];

const DESPLAZAMIENTO = 'Desplazamiento forzado';
const VIOLENCIA = 'Violencia contra la mujer';
const INTRAFAMILIAR = 'Maltrato intrafamiliar';

// Participación aproximada por situación
const PESO_SITUACION = { [DESPLAZAMIENTO]: 40, [VIOLENCIA]: 33, [INTRAFAMILIAR]: 27 };

// Desplazamiento: departamentos con mayor afectación por el conflicto
const PESO_DEPTO_DESPLAZAMIENTO = {
    'Antioquia': 14, 'Cauca': 12, 'Norte de Santander': 12, 'Nariño': 11, 'Chocó': 9, 'Valle del Cauca': 8,
    'Bolívar': 5, 'Córdoba': 5, 'Putumayo': 4, 'Arauca': 4, 'Caquetá': 3, 'Meta': 3, 'Guaviare': 2, 'Huila': 2,
    'Tolima': 2, 'Cesar': 2, 'Magdalena': 2, 'Sucre': 1.5, 'La Guajira': 1.5, 'Bogotá D.C.': 1.5, 'Santander': 1.2,
    'Risaralda': 0.8, 'Caldas': 0.8, 'Cundinamarca': 0.6, 'Atlántico': 0.6, 'Boyacá': 0.4, 'Quindío': 0.3,
    'Casanare': 0.6, 'Vichada': 0.5, 'Guainía': 0.3, 'Vaupés': 0.3, 'Amazonas': 0.3, 'San Andrés y Providencia': 0.05
};
// Violencia y maltrato: proporcional a la población
const PESO_DEPTO_POBLACION = {
    'Bogotá D.C.': 16, 'Antioquia': 13, 'Valle del Cauca': 9, 'Cundinamarca': 7, 'Atlántico': 5, 'Santander': 4.5,
    'Bolívar': 4, 'Córdoba': 3.5, 'Norte de Santander': 3.3, 'Nariño': 3, 'Cauca': 2.9, 'Tolima': 2.7, 'Magdalena': 2.7,
    'Cesar': 2.6, 'Boyacá': 2.4, 'Huila': 2.2, 'Meta': 2.1, 'Caldas': 2, 'Risaralda': 1.9, 'Sucre': 1.9,
    'La Guajira': 1.9, 'Quindío': 1.1, 'Chocó': 1, 'Casanare': 0.9, 'Caquetá': 0.8, 'Putumayo': 0.7, 'Arauca': 0.6,
    'Guaviare': 0.18, 'Amazonas': 0.15, 'Vichada': 0.15, 'Guainía': 0.1, 'San Andrés y Providencia': 0.1, 'Vaupés': 0.08
};
// Zonas de frontera y grandes ciudades con más población migrante (PPT / cédula de extranjería)
const FACTOR_MIGRANTE = { 'Norte de Santander': 4, 'La Guajira': 4, 'Arauca': 3, 'Bogotá D.C.': 2, 'Atlántico': 2, 'Antioquia': 1.5 };
// Departamentos rurales donde los predios abandonados son más grandes
const RURALES = new Set(['Chocó', 'Cauca', 'Nariño', 'Putumayo', 'Caquetá', 'Guaviare', 'Meta', 'Arauca', 'Vichada',
    'Guainía', 'Vaupés', 'Amazonas', 'Córdoba', 'Casanare', 'Bolívar']);

// Eventos de desplazamiento masivo: muchos casos en pocos días y en un solo departamento
const EVENTOS = [
    { nombre: 'Catatumbo', departamento: 'Norte de Santander', inicio: Date.UTC(2025, 0, 16), dias: 25, tickets: 0.06 },
    { nombre: 'Cauca', departamento: 'Cauca', inicio: Date.UTC(2024, 9, 12), dias: 14, tickets: 0.02 },
    { nombre: 'Bajo Baudó', departamento: 'Chocó', inicio: Date.UTC(2025, 5, 3), dias: 12, tickets: 0.015 },
    { nombre: 'Sur de Bolívar', departamento: 'Bolívar', inicio: Date.UTC(2026, 3, 20), dias: 10, tickets: 0.012 }
].filter(e => e.inicio >= INICIO && e.inicio < AHORA);

// Duración típica de la atención (días) según la situación
const MEDIANA_DIAS = { [VIOLENCIA]: 3, [INTRAFAMILIAR]: 6, [DESPLAZAMIENTO]: 14 };

const COMENTARIOS_FUNCIONARIO = {
    [DESPLAZAMIENTO]: [
        'Se orienta a la persona para rendir declaración ante la Personería o la Defensoría del Pueblo.',
        'Se verifica la inclusión en el Registro Único de Víctimas. Pendiente respuesta de la Unidad para las Víctimas.',
        'Se programa llamada para revisar las necesidades de alojamiento temporal del núcleo familiar.',
        'Se remite a la Defensoría del Pueblo regional para acompañamiento en la declaración.',
        'Se solicitan documentos que acrediten la tenencia del predio abandonado.',
        'Se informa sobre la ruta de atención humanitaria inmediata en el municipio receptor.'
    ],
    [VIOLENCIA]: [
        'Se establece contacto con la usuaria y se activa la ruta de atención con la Línea Púrpura.',
        'Se orienta sobre medidas de protección ante la Comisaría de Familia.',
        'Se brinda primer apoyo psicosocial por llamada y se agenda seguimiento.',
        'Se verifica que la usuaria se encuentre en un lugar seguro.',
        'Se remite a la Fiscalía para la denuncia y se explica el procedimiento.'
    ],
    [INTRAFAMILIAR]: [
        'Se orienta a la familia para acudir al centro zonal del ICBF más cercano.',
        'Se programa seguimiento con el equipo psicosocial.',
        'Se informa a la Comisaría de Familia para valorar medidas de protección.',
        'Se confirma la asistencia a la cita en el centro zonal del ICBF.',
        'Se brinda orientación sobre la ruta de restablecimiento de derechos de niñas, niños y adolescentes.'
    ]
};
const COMENTARIOS_SOLICITANTE = [
    'Quisiera saber en qué va mi caso, por favor.',
    'Ya tengo los documentos que me pidieron, ¿a dónde los envío?',
    'Cambié de número de teléfono, por favor tenerlo en cuenta.',
    'Gracias por la llamada, quedo atenta a la cita.',
    'No he podido comunicarme con la entidad, ¿me pueden ayudar?',
    'La situación empeoró esta semana, necesito ayuda pronto.',
    'Ya fui a la cita que me indicaron.'
];
const OBSERVACIONES_CIERRE = {
    [DESPLAZAMIENTO]: [
        'Declaración rendida ante la Defensoría del Pueblo. Se entrega información de la ruta de ayuda humanitaria.',
        'Persona incluida en el RUV y remitida a la Unidad para las Víctimas para atención humanitaria.',
        'Se completa la orientación; la persona continúa el proceso de restitución de tierras.',
        'Remitido a la Personería municipal, que confirma la recepción de la declaración.'
    ],
    [VIOLENCIA]: [
        'Caso remitido y atendido por la Línea Púrpura. La usuaria cuenta con medida de protección.',
        'La usuaria recibió acompañamiento psicosocial y orientación jurídica.',
        'Denuncia radicada en la Fiscalía con acompañamiento. Se cierra la orientación.',
        'Se confirma la atención por la Comisaría de Familia.'
    ],
    [INTRAFAMILIAR]: [
        'Familia atendida en el centro zonal del ICBF; se abre proceso de restablecimiento de derechos.',
        'Se confirma la atención por la Comisaría de Familia y el seguimiento psicosocial.',
        'La familia asistió a la valoración del ICBF. Se cierra la orientación.',
        'Caso remitido al ICBF, que asume el seguimiento.'
    ]
};
const POSITIVOS = ['La atención fue rápida.', 'Me explicaron muy bien la ruta a seguir.', 'Me sentí escuchada y acompañada.',
    'El funcionario fue muy amable.', 'Me ayudaron a saber a qué entidad ir.'];
const NEGATIVOS = ['Tardaron mucho en responder.', 'Tuve que repetir mi información varias veces.',
    'No me llamaron cuando dijeron.', 'El proceso con la entidad fue muy lento.'];
const MEJORAS = ['Responder más rápido.', 'Tener atención por WhatsApp.', 'Hacer más seguimiento después de la remisión.',
    'Explicar mejor los tiempos de cada entidad.'];

// ===================== Utilidades de base de datos =====================

// Inserta filas en lotes y devuelve las filas de RETURNING en el mismo orden
async function insertar(db, tabla, columnas, filas, returning = null) {
    const resultado = [];
    const tamano = Math.max(1, Math.floor(20000 / columnas.length));
    for (let i = 0; i < filas.length; i += tamano) {
        const lote = filas.slice(i, i + tamano);
        const params = [];
        const valores = lote.map(fila => '(' + fila.map(valor => { params.push(valor); return '$' + params.length; }).join(', ') + ')');
        const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${valores.join(', ')}` + (returning ? ` RETURNING ${returning}` : '');
        const { rows } = await db.query(sql, params);
        resultado.push(...rows);
    }
    return resultado;
}

async function idsPorNombre(db, tabla, columna) {
    const { rows } = await db.query(`SELECT id, ${columna} AS nombre FROM ${tabla}`);
    return Object.fromEntries(rows.map(r => [r.nombre, r.id]));
}

async function limpiarDemo(db) {
    const demo = `SELECT id FROM usuarios WHERE email LIKE '%@${DOMINIO}'`;
    await db.query(`DELETE FROM encuestas_satisfaccion WHERE usuario_id IN (${demo})`);
    await db.query(`DELETE FROM formularios WHERE usuario_id IN (${demo})`); // comentarios e historial caen en cascada
    // Si un funcionario demo atendió tickets reales, esos tickets se conservan sin él
    await db.query(`UPDATE formularios SET funcionario_id = NULL WHERE funcionario_id IN (${demo})`);
    await db.query(`UPDATE formularios SET cerrado_por = NULL WHERE cerrado_por IN (${demo})`);
    await db.query(`DELETE FROM ticket_comentarios WHERE usuario_id IN (${demo})`);
    await db.query(`UPDATE ticket_historial SET usuario_id = NULL WHERE usuario_id IN (${demo})`);
    const { rowCount } = await db.query(`DELETE FROM usuarios WHERE email LIKE '%@${DOMINIO}'`);
    return rowCount;
}

// ===================== Generación =====================

function sinTildes(texto) {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

const emailsUsados = new Set();
function email(nombre, apellido) {
    const base = `${sinTildes(nombre)}.${sinTildes(apellido)}`;
    let candidato = `${base}@${DOMINIO}`;
    for (let n = 2; emailsUsados.has(candidato); n++) candidato = `${base}${n}@${DOMINIO}`;
    emailsUsados.add(candidato);
    return candidato;
}

const documentosUsados = new Set();
function documento(tipo) {
    let numero;
    do {
        numero = {
            'Cédula de ciudadanía': () => probable(0.6) ? '10' + entre(10000000, 99999999) : String(entre(20000000, 99999999)),
            'Tarjeta de identidad': () => '1' + entre(100000000, 199999999),
            'Registro civil': () => '1' + entre(100000000, 199999999),
            'Cédula de extranjería': () => String(entre(100000, 9999999)),
            'Pasaporte': () => 'P' + entre(1000000, 9999999),
            'Permiso por Protección Temporal (PPT)': () => String(entre(1000000, 9999999))
        }[tipo]();
    } while (documentosUsados.has(numero));
    documentosUsados.add(numero);
    return numero;
}

const telefono = () => '3' + elegir(['00', '01', '02', '04', '05', '10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '21', '23', '50', '22']) + entre(1000000, 9999999);

function nuevaPersona(situacion, departamento) {
    const genero = ponderado({
        [DESPLAZAMIENTO]: { Femenino: 52, Masculino: 45, 'No binario': 1, 'Prefiero no decirlo': 2 },
        [VIOLENCIA]: { Femenino: 96, Masculino: 1, 'No binario': 1.5, 'Prefiero no decirlo': 1.5 },
        [INTRAFAMILIAR]: { Femenino: 68, Masculino: 28, 'No binario': 1, 'Prefiero no decirlo': 3 }
    }[situacion]);
    const nombre = elegir(genero === 'Masculino' ? NOMBRES_M : genero === 'Femenino' ? NOMBRES_F : elegir([NOMBRES_F, NOMBRES_M]));
    const apellido1 = elegir(APELLIDOS);
    const apellido2 = elegir(APELLIDOS);
    const migrante = (FACTOR_MIGRANTE[departamento] || 0.5) * 0.04;
    const tipo = ponderado({
        'Cédula de ciudadanía': 80,
        'Tarjeta de identidad': situacion === INTRAFAMILIAR ? 14 : 3,
        'Registro civil': situacion === INTRAFAMILIAR ? 3 : 0.3,
        'Cédula de extranjería': 100 * migrante * 0.35,
        'Permiso por Protección Temporal (PPT)': 100 * migrante,
        'Pasaporte': 0.8
    });
    return {
        nombre, apellidos: `${apellido1} ${apellido2}`, genero, tipo,
        numero: documento(tipo), telefono: telefono(), departamento,
        email: email(nombre, apellido1), tickets: []
    };
}

// Probabilidad relativa de que un caso de cierta situación ocurra en un momento dado
function intensidad(situacion, ms) {
    const progreso = (ms - INICIO) / (AHORA - INICIO);
    let f = 0.6 + 0.8 * progreso; // la plataforma gana usuarios con el tiempo
    const mes = mesColombia(ms);
    const finDeSemana = [0, 6].includes(diaSemanaColombia(ms));
    if (situacion === INTRAFAMILIAR) {
        if (mes === 12 || mes === 1) f *= 1.45;
        if (mes === 6 || mes === 7) f *= 1.15; // vacaciones escolares
        if (finDeSemana) f *= 1.3;
    } else if (situacion === VIOLENCIA) {
        if (mes === 12) f *= 1.25;
        if (mes === 3) f *= 1.1;
        if (finDeSemana) f *= 1.35;
    } else if (finDeSemana) {
        f *= 0.85;
    }
    return f;
}

function horaDelDia(situacion) {
    // Violencia y maltrato se reportan más en la noche; desplazamiento en horario diurno
    const pesos = situacion === DESPLAZAMIENTO
        ? [1, 0.5, 0.3, 0.3, 0.5, 1, 2, 4, 7, 9, 9, 8, 6, 7, 8, 8, 7, 6, 4, 3, 2, 2, 1.5, 1]
        : [3, 2.5, 1.5, 1, 0.8, 1, 2, 3, 4, 5, 5, 5, 4.5, 4.5, 5, 5, 5, 5.5, 6, 7, 7.5, 7, 6, 4.5];
    return Number(ponderado(Object.fromEntries(pesos.map((p, h) => [h, p]))));
}

function generarCasos(departamentosValidos) {
    const casos = [];
    const totalEventos = EVENTOS.reduce((s, e) => s + Math.round(e.tickets * TOTAL_TICKETS), 0);
    const base = TOTAL_TICKETS - totalEventos;
    const maxIntensidad = 1.4 * 1.45 * 1.35;

    // Casos normales: día por muestreo de rechazo según la intensidad
    while (casos.length < base) {
        const situacion = ponderado(PESO_SITUACION);
        const dia = INICIO + azar() * (AHORA - INICIO);
        if (azar() * maxIntensidad > intensidad(situacion, dia)) continue;
        const pesos = situacion === DESPLAZAMIENTO ? PESO_DEPTO_DESPLAZAMIENTO : PESO_DEPTO_POBLACION;
        const departamento = ponderado(pesos);
        if (!departamentosValidos[departamento]) continue;
        const creado = fechaColombia(dia, horaDelDia(situacion), entre(0, 59));
        if (creado > AHORA) continue;
        casos.push({ situacion, departamento, creado, evento: null });
    }

    // Eventos masivos: casi todo en la primera semana, y luego decae
    for (const evento of EVENTOS) {
        const cantidad = Math.round(evento.tickets * TOTAL_TICKETS);
        for (let i = 0; i < cantidad; i++) {
            const dia = evento.inicio + Math.min(evento.dias, -Math.log(1 - azar()) * evento.dias / 3) * DIA;
            const creado = fechaColombia(dia, horaDelDia(DESPLAZAMIENTO), entre(0, 59));
            if (creado > AHORA) continue;
            casos.push({ situacion: DESPLAZAMIENTO, departamento: evento.departamento, creado, evento: evento.nombre });
        }
    }
    return casos.sort((a, b) => a.creado - b.creado);
}

// Asigna una persona a cada caso; algunas personas vuelven a pedir ayuda
function asignarPersonas(casos) {
    const personas = [];
    const porGrupo = new Map(); // situación|departamento -> personas
    const recurrencia = { [DESPLAZAMIENTO]: 0.07, [VIOLENCIA]: 0.1, [INTRAFAMILIAR]: 0.18 };
    for (const caso of casos) {
        const clave = `${caso.situacion}|${caso.departamento}`;
        const grupo = porGrupo.get(clave) || [];
        const candidatas = grupo.filter(p => caso.creado - p.tickets[p.tickets.length - 1].creado > 30 * DIA);
        let persona;
        if (candidatas.length > 0 && probable(recurrencia[caso.situacion])) {
            persona = elegir(candidatas);
        } else {
            persona = nuevaPersona(caso.situacion, caso.departamento);
            personas.push(persona);
            grupo.push(persona);
            porGrupo.set(clave, grupo);
        }
        persona.tickets.push(caso);
        caso.persona = persona;
    }
    return personas;
}

function crearFuncionarios() {
    const funcionarios = [];
    const especialidades = [
        ...Array(6).fill(DESPLAZAMIENTO), ...Array(5).fill(VIOLENCIA), ...Array(4).fill(INTRAFAMILIAR), null, null
    ];
    for (const especialidad of especialidades) {
        const genero = probable(0.6) ? 'F' : 'M';
        const nombre = elegir(genero === 'F' ? NOMBRES_F : NOMBRES_M);
        const apellido = `${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
        funcionarios.push({
            nombre, apellido, especialidad,
            email: email(nombre, apellido.split(' ')[0]),
            // < 1 = más rápido. Algunos son claramente más lentos (patrón a descubrir)
            eficiencia: limitar(lognormal(1, 0.35), 0.5, 2.5),
            // Cuánto acompañan con comentarios
            dedicacion: limitar(lognormal(1, 0.4), 0.3, 2.5)
        });
    }
    return funcionarios;
}

// Simula la vida del ticket y devuelve su estado actual, historial, comentarios y encuesta
function simularTicket(caso, funcionarios) {
    const eventos = []; // { fecha, accion, detalle, actor: 'solicitante' | funcionario }
    const comentarios = [];
    const s = caso.situacion;
    const ticket = { estado: 'Pendiente', funcionario: null, fechaCierre: null, cerradoPor: null, observacion: null, actualizado: null };
    const registrar = (fecha, accion, detalle, actor) => {
        if (fecha <= AHORA) eventos.push({ fecha, accion, detalle, actor });
        return fecha <= AHORA;
    };

    registrar(caso.creado, 'Creación', 'Ticket creado por el solicitante', 'solicitante');

    // Asignación: tarda más los fines de semana y durante eventos masivos
    let demora = lognormal(caso.evento ? 30 : 6, 0.9) * HORA;
    if ([0, 6].includes(diaSemanaColombia(caso.creado))) demora *= 2.2;
    if (probable(0.2)) demora = lognormal(4, 0.6) * DIA; // casos que quedan en cola varios días
    // Congestión actual: en las últimas tres semanas el equipo no da abasto
    if (AHORA - caso.creado < 21 * DIA && probable(0.5)) demora = lognormal(15, 0.5) * DIA;
    const especialistas = funcionarios.filter(f => f.especialidad === s);
    const funcionario = probable(0.82) ? elegir(especialistas) : elegir(funcionarios);
    const tAsignacion = caso.creado + demora;
    if (!registrar(tAsignacion, 'Asignación', `Asignado a ${funcionario.nombre} ${funcionario.apellido}`, funcionario)) return { ticket, eventos, comentarios };
    ticket.funcionario = funcionario;
    ticket.actualizado = tAsignacion;

    const tProceso = tAsignacion + lognormal(5, 1) * HORA;
    if (!registrar(tProceso, 'Cambio de estado', 'Pendiente → En proceso', funcionario)) return { ticket, eventos, comentarios };
    ticket.estado = 'En proceso';
    ticket.actualizado = tProceso;

    // Duración de la atención: situación × eficiencia × congestión × azar.
    // 2% quedan estancados (casos atípicos).
    const estancado = probable(0.02);
    const dias = estancado
        ? entre(90, 400)
        : lognormal(MEDIANA_DIAS[s], 0.55) * funcionario.eficiencia * (caso.evento ? 1.8 : 1);
    const tResuelto = tProceso + dias * DIA;

    // Comentarios durante la atención
    const nFuncionario = Math.round(limitar(lognormal(1.2 * funcionario.dedicacion, 0.5) * (s === DESPLAZAMIENTO ? 1.4 : 1), 0, 6));
    const nSolicitante = probable(dias > 10 ? 0.6 : 0.3) ? entre(1, dias > 20 ? 3 : 2) : 0;
    const textos = COMENTARIOS_FUNCIONARIO[s];
    for (let i = 0; i < nFuncionario; i++) {
        const t = tProceso + azar() * (tResuelto - tProceso);
        if (t <= AHORA) comentarios.push({ fecha: t, autor: funcionario, texto: elegir(textos) });
    }
    for (let i = 0; i < nSolicitante; i++) {
        const t = tProceso + azar() * (tResuelto - tProceso);
        if (t <= AHORA) comentarios.push({ fecha: t, autor: 'solicitante', texto: elegir(COMENTARIOS_SOLICITANTE) });
    }
    comentarios.sort((a, b) => a.fecha - b.fecha);
    for (const c of comentarios) {
        registrar(c.fecha, 'Comentario', c.texto.length > 120 ? c.texto.slice(0, 117) + '...' : c.texto, c.autor);
    }

    if (!registrar(tResuelto, 'Cambio de estado', 'En proceso → Resuelto', funcionario)) return { ticket, eventos, comentarios };
    ticket.estado = 'Resuelto';
    ticket.actualizado = tResuelto;

    let tCierre = tResuelto + lognormal(1.5, 1) * funcionario.eficiencia * DIA;
    let observacion = elegir(OBSERVACIONES_CIERRE[s]);
    if (!registrar(tCierre, 'Cierre', observacion, funcionario)) return { ticket, eventos, comentarios, dias };
    Object.assign(ticket, { estado: 'Cerrado', fechaCierre: tCierre, cerradoPor: funcionario, observacion, actualizado: tCierre });

    // Reapertura (4%): la persona vuelve porque la remisión no funcionó
    let reabierto = false;
    if (probable(0.04)) {
        const tReapertura = tCierre + lognormal(6, 0.6) * DIA;
        if (registrar(tReapertura, 'Reapertura', 'Cerrado → En proceso', funcionario)) {
            reabierto = true;
            Object.assign(ticket, { estado: 'En proceso', fechaCierre: null, cerradoPor: null, observacion: null, actualizado: tReapertura });
            const tSegundo = tReapertura + lognormal(MEDIANA_DIAS[s] / 2, 0.5) * funcionario.eficiencia * DIA;
            if (registrar(tSegundo, 'Cambio de estado', 'En proceso → Resuelto', funcionario)) {
                ticket.estado = 'Resuelto';
                ticket.actualizado = tSegundo;
                tCierre = tSegundo + lognormal(1, 0.9) * DIA;
                observacion = elegir(OBSERVACIONES_CIERRE[s]);
                if (registrar(tCierre, 'Cierre', observacion, funcionario)) {
                    Object.assign(ticket, { estado: 'Cerrado', fechaCierre: tCierre, cerradoPor: funcionario, observacion, actualizado: tCierre });
                }
            }
        }
    }

    // Encuesta (45% de los tickets cerrados). La calificación depende del tiempo total,
    // las reaperturas y el acompañamiento del funcionario.
    let encuesta = null;
    if (ticket.estado === 'Cerrado' && probable(0.45)) {
        const diasTotales = (ticket.fechaCierre - caso.creado) / DIA;
        const lentitud = diasTotales / (MEDIANA_DIAS[s] * 1.5);
        const base = 4.6 - 0.9 * Math.log1p(lentitud) - (reabierto ? 1.2 : 0) + 0.15 * Math.min(nFuncionario, 4) + 0.4 * normal();
        const nota = x => Math.round(limitar(x, 1, 5));
        const calificacion = nota(base);
        encuesta = {
            fecha: ticket.fechaCierre + lognormal(1.5, 0.8) * DIA,
            calificacion,
            satisfaccion: nota(base + 0.4 * normal()),
            rapidez: nota(5 - 1.6 * Math.log1p(lentitud) + 0.5 * normal()),
            amabilidad: nota(4.6 - 0.3 * Math.log1p(lentitud) + 0.15 * nFuncionario + 0.5 * normal()),
            claridad: nota(base + 0.2 + 0.5 * normal()),
            utilidad: nota(base + 0.5 * normal()),
            recomienda: Math.round(limitar(base * 2.2 - 1 + 1.2 * normal(), 0, 10)),
            fuente: ponderado({ recomendacion: 35, redes: 25, busqueda: 20, evento: 12, otro: 8 }),
            positivos: calificacion >= 4 ? elegir(POSITIVOS) : null,
            negativos: calificacion <= 3 ? elegir(NEGATIVOS) : null,
            mejoras: probable(0.4) ? elegir(MEJORAS) : null,
            consentimiento: probable(0.3)
        };
        if (encuesta.fecha > AHORA) encuesta = null;
    }

    return { ticket, eventos, comentarios, encuesta };
}

// ===================== Programa principal =====================

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error('Falta DATABASE_URL (en el entorno o en el archivo .env).');
    }
    const host = new URL(process.env.DATABASE_URL).host;
    console.log(`Base de datos: ${host}`);
    await initDb(); // asegura que el esquema esté al día

    if (args['solo-limpiar']) {
        const borrados = await transaccion(limpiarDemo);
        console.log(`Datos demo eliminados (${borrados} cuentas).`);
        return;
    }

    console.log(`Generando ${TOTAL_TICKETS} tickets con semilla ${SEMILLA}...`);
    const db0 = pool;
    const ids = {
        generos: await idsPorNombre(db0, 'generos', 'descripcion'),
        tipos: await idsPorNombre(db0, 'tipos_identificacion', 'descripcion'),
        situaciones: await idsPorNombre(db0, 'situaciones', 'situacion'),
        departamentos: await idsPorNombre(db0, 'departamentos', 'nombre'),
        unidades: await idsPorNombre(db0, 'unidades_medida', 'nombre'),
        roles: await idsPorNombre(db0, 'roles', 'nombre')
    };
    const rolUsuario = (await db0.query('SELECT id FROM roles WHERE es_registro ORDER BY id LIMIT 1')).rows[0].id;
    const rolFuncionario = ids.roles['Funcionario'];
    if (!rolFuncionario) throw new Error('No existe el rol "Funcionario".');

    const casos = generarCasos(ids.departamentos);
    const personas = asignarPersonas(casos);
    const funcionarios = crearFuncionarios();
    const simulaciones = casos.map(caso => ({ caso, ...simularTicket(caso, funcionarios) }));
    const hash = await bcrypt.hash(PASSWORD_DEMO, 10);

    const inicio = Date.now();
    await transaccion(async (db) => {
        const borrados = await limpiarDemo(db);
        if (borrados) console.log(`  Datos demo anteriores eliminados (${borrados} cuentas).`);

        // Funcionarios (registrados antes del primer ticket)
        const filasFuncionarios = funcionarios.map(f => [f.nombre, f.apellido, f.email, telefono(), hash, rolFuncionario,
            new Date(INICIO - entre(5, 60) * DIA)]);
        const idsFuncionarios = await insertar(db, 'usuarios',
            ['nombre', 'apellido', 'email', 'telefono', 'password', 'rol_id', 'fecha_registro'], filasFuncionarios, 'id');
        funcionarios.forEach((f, i) => { f.id = idsFuncionarios[i].id; });
        console.log(`  ${funcionarios.length} funcionarios`);

        // Solicitantes: se registran poco antes de su primer ticket
        const filasPersonas = personas.map(p => [p.nombre, p.apellidos, p.email, p.telefono, hash, rolUsuario,
            new Date(p.tickets[0].creado - entre(2, 40) * 60 * 1000)]);
        const idsPersonas = await insertar(db, 'usuarios',
            ['nombre', 'apellido', 'email', 'telefono', 'password', 'rol_id', 'fecha_registro'], filasPersonas, 'id');
        personas.forEach((p, i) => { p.id = idsPersonas[i].id; });
        console.log(`  ${personas.length} solicitantes`);

        // Tickets
        const filasTickets = simulaciones.map(({ caso, ticket }) => {
            const p = caso.persona;
            let unidad = null, cantidad = null;
            if (caso.situacion === DESPLAZAMIENTO && probable(0.68)) {
                const rural = RURALES.has(caso.departamento);
                unidad = ponderado(rural ? { 'Hectáreas': 75, 'Fanegadas': 20, 'Metros cuadrados': 5 } : { 'Hectáreas': 45, 'Fanegadas': 20, 'Metros cuadrados': 35 });
                cantidad = unidad === 'Metros cuadrados'
                    ? Math.round(limitar(lognormal(rural ? 2500 : 300, 0.9), 20, 50000))
                    : Math.max(1, Math.round(lognormal(rural ? 9 : 3, 0.9)));
            }
            return [
                `${p.nombre} ${p.apellidos}`, ids.tipos[p.tipo], p.numero, ids.generos[p.genero], p.telefono,
                ids.situaciones[caso.situacion], ids.departamentos[caso.departamento],
                unidad ? ids.unidades[unidad] : null, cantidad, ticket.estado, new Date(caso.creado), p.id,
                ticket.funcionario ? ticket.funcionario.id : null,
                ticket.actualizado ? new Date(ticket.actualizado) : null,
                ticket.fechaCierre ? new Date(ticket.fechaCierre) : null,
                ticket.cerradoPor ? ticket.cerradoPor.id : null,
                ticket.observacion
            ];
        });
        const idsTickets = await insertar(db, 'formularios', [
            'nombre', 'tipo_identificacion_id', 'numero_identificacion', 'genero_id', 'telefono', 'situacion_id',
            'departamento_id', 'unidad_medida_id', 'cantidad', 'estado', 'fecha_creacion', 'usuario_id',
            'funcionario_id', 'fecha_actualizacion', 'fecha_cierre', 'cerrado_por', 'observacion_cierre'
        ], filasTickets, 'id');
        simulaciones.forEach((s, i) => { s.id = idsTickets[i].id; });
        console.log(`  ${simulaciones.length} tickets`);

        const actor = (s, a) => (a === 'solicitante' ? s.caso.persona.id : a.id);

        const filasHistorial = simulaciones.flatMap(s => s.eventos.map(e =>
            [s.id, actor(s, e.actor), e.accion, e.detalle, new Date(e.fecha)]));
        await insertar(db, 'ticket_historial', ['formulario_id', 'usuario_id', 'accion', 'detalle', 'fecha'], filasHistorial);
        console.log(`  ${filasHistorial.length} registros de historial`);

        const filasComentarios = simulaciones.flatMap(s => s.comentarios.map(c =>
            [s.id, actor(s, c.autor), c.texto, new Date(c.fecha)]));
        await insertar(db, 'ticket_comentarios', ['formulario_id', 'usuario_id', 'comentario', 'fecha'], filasComentarios);
        console.log(`  ${filasComentarios.length} comentarios`);

        const filasEncuestas = simulaciones.filter(s => s.encuesta).map(s => {
            const e = s.encuesta;
            const p = s.caso.persona;
            return [p.id, s.id, String(ids.situaciones[s.caso.situacion]), new Date(s.ticket.fechaCierre).toISOString().slice(0, 10),
                e.fuente, e.calificacion, e.satisfaccion, e.rapidez, e.amabilidad, e.claridad, e.utilidad, e.mejoras,
                e.recomienda, e.positivos, e.negativos, e.consentimiento,
                e.consentimiento ? `${p.nombre} ${p.apellidos}` : null, e.consentimiento ? p.email : null, new Date(e.fecha)];
        });
        await insertar(db, 'encuestas_satisfaccion', [
            'usuario_id', 'formulario_id', 'tipo_servicio', 'fecha_servicio', 'fuente', 'calificacion', 'satisfaccion',
            'rapidez', 'amabilidad', 'claridad', 'utilidad', 'mejoras', 'recomienda', 'aspectos_positivos',
            'aspectos_negativos', 'consentimiento_contacto', 'nombre_contacto', 'email_contacto', 'fecha_creacion'
        ], filasEncuestas);
        console.log(`  ${filasEncuestas.length} encuestas`);
    });

    const estados = simulaciones.reduce((acc, s) => ({ ...acc, [s.ticket.estado]: (acc[s.ticket.estado] || 0) + 1 }), {});
    console.log(`Listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s. Estados: ${JSON.stringify(estados)}`);
    console.log(`Cuentas demo: cualquier correo @${DOMINIO} con la contraseña ${PASSWORD_DEMO}. Funcionarios:`);
    funcionarios.slice(0, 3).forEach(f => console.log(`  ${f.email} (${f.especialidad || 'general'})`));
}

main()
    .catch(error => {
        console.error('Error:', error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
