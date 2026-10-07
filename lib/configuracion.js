const { pool } = require('../DB/db');

// Configuración de los campos del formulario para un rol (HU9).
// Sin fila propia en roles_campos, el campo es visible, habilitado y
// obligatorio según su valor por defecto.
async function obtenerCamposRol(rolId) {
    const { rows } = await pool.query(`
        SELECT c.id, c.codigo, c.etiqueta,
               COALESCE(rc.visible, TRUE) AS visible,
               COALESCE(rc.habilitado, TRUE) AS habilitado,
               COALESCE(rc.obligatorio, c.obligatorio_defecto) AS obligatorio
        FROM campos_formulario c
        LEFT JOIN roles_campos rc ON rc.campo_id = c.id AND rc.rol_id = $1
        ORDER BY c.orden
    `, [rolId]);
    return rows;
}

// Tarjetas del panel con su visibilidad para un rol (HU8).
// El rol administrador las ve todas salvo que se desactiven explícitamente.
async function obtenerTarjetasRol(rolId, esAdmin) {
    const { rows } = await pool.query(`
        SELECT t.id, t.codigo, t.nombre, t.descripcion, t.ruta, t.permiso_codigo,
               COALESCE(rt.visible, $2) AS visible
        FROM tarjetas t
        LEFT JOIN roles_tarjetas rt ON rt.tarjeta_id = t.id AND rt.rol_id = $1
        ORDER BY t.orden
    `, [rolId, esAdmin]);
    return rows;
}

module.exports = { obtenerCamposRol, obtenerTarjetasRol };
