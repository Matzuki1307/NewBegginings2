// Validaciones compartidas por las rutas de la API

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO = /^\+?[0-9 ]{7,15}$/;
const NUMERO_ID = /^[A-Za-z0-9-]{3,20}$/;

// Convierte '' y undefined en null y recorta los textos
function limpiar(valor) {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string') {
        const recortado = valor.trim();
        return recortado === '' ? null : recortado;
    }
    return valor;
}

function esEmail(valor) {
    return typeof valor === 'string' && valor.length <= 255 && EMAIL.test(valor);
}

function esTelefono(valor) {
    return typeof valor === 'string' && TELEFONO.test(valor);
}

function esNumeroIdentificacion(valor) {
    return typeof valor === 'string' && NUMERO_ID.test(valor);
}

function esEnteroPositivo(valor) {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 && numero <= 2147483647;
}

// Mínimo 8 caracteres, una mayúscula y un número (la misma regla de registro.html)
function esPasswordSegura(valor) {
    return typeof valor === 'string' && valor.length >= 8 && valor.length <= 72
        && /[A-Z]/.test(valor) && /[0-9]/.test(valor);
}

const MENSAJE_PASSWORD = 'La contraseña debe tener mínimo 8 caracteres, una letra mayúscula y un número.';

// Devuelve la lista de etiquetas de los campos obligatorios que vienen vacíos
function camposFaltantes(datos, obligatorios) {
    return Object.entries(obligatorios)
        .filter(([campo]) => limpiar(datos[campo]) === null)
        .map(([, etiqueta]) => etiqueta);
}

module.exports = {
    limpiar,
    esEmail,
    esTelefono,
    esNumeroIdentificacion,
    esEnteroPositivo,
    esPasswordSegura,
    MENSAJE_PASSWORD,
    camposFaltantes
};
