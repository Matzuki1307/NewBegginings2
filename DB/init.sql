-- Esquema de New Beginnings (PostgreSQL).
-- Es idempotente: el servidor lo ejecuta en cada arranque, así que solo crea
-- lo que falte y no duplica los datos de catálogo.

-- ===== Catálogos =====

CREATE TABLE IF NOT EXISTS generos (
    id          SERIAL PRIMARY KEY,
    descripcion VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tipos_identificacion (
    id          SERIAL PRIMARY KEY,
    descripcion VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS situaciones (
    id        SERIAL PRIMARY KEY,
    situacion VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS departamentos (
    id     SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS unidades_medida (
    id     SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);

-- ===== Datos =====

CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(100) NOT NULL,
    apellido       VARCHAR(100) NOT NULL,
    email          VARCHAR(255) NOT NULL UNIQUE,
    telefono       VARCHAR(30),
    password       VARCHAR(255) NOT NULL,
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formularios (
    id                     SERIAL PRIMARY KEY,
    nombre                 VARCHAR(200) NOT NULL,
    tipo_identificacion_id INT NOT NULL REFERENCES tipos_identificacion(id),
    numero_identificacion  VARCHAR(30) NOT NULL,
    genero_id              INT NOT NULL REFERENCES generos(id),
    telefono               VARCHAR(30) NOT NULL,
    situacion_id           INT NOT NULL REFERENCES situaciones(id),
    departamento_id        INT NOT NULL REFERENCES departamentos(id),
    unidad_medida_id       INT REFERENCES unidades_medida(id),
    cantidad               INT,
    estado                 VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
    fecha_creacion         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id             INT NOT NULL REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_formularios_usuario ON formularios(usuario_id);

CREATE TABLE IF NOT EXISTS encuestas_satisfaccion (
    id                      SERIAL PRIMARY KEY,
    usuario_id              INT REFERENCES usuarios(id),
    tipo_servicio           VARCHAR(100),
    otro_servicio           VARCHAR(200),
    fecha_servicio          DATE,
    fuente                  VARCHAR(50),
    calificacion            INT,
    satisfaccion            INT,
    rapidez                 INT,
    amabilidad              INT,
    claridad                INT,
    utilidad                INT,
    mejoras                 TEXT,
    recomienda              INT,
    aspectos_positivos      TEXT,
    aspectos_negativos      TEXT,
    comentarios_adicionales TEXT,
    consentimiento_contacto BOOLEAN NOT NULL DEFAULT FALSE,
    nombre_contacto         VARCHAR(200),
    email_contacto          VARCHAR(255),
    fecha_creacion          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== Datos semilla =====

INSERT INTO generos (descripcion) VALUES
    ('Femenino'),
    ('Masculino'),
    ('No binario'),
    ('Prefiero no decirlo')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO tipos_identificacion (descripcion) VALUES
    ('Cédula de ciudadanía'),
    ('Tarjeta de identidad'),
    ('Registro civil'),
    ('Cédula de extranjería'),
    ('Pasaporte'),
    ('Permiso por Protección Temporal (PPT)')
ON CONFLICT (descripcion) DO NOTHING;

-- 'Desplazamiento forzado' debe escribirse exactamente así: formulario.js
-- compara ese texto para mostrar los campos de unidad de medida y cantidad.
INSERT INTO situaciones (situacion) VALUES
    ('Desplazamiento forzado'),
    ('Violencia contra la mujer'),
    ('Maltrato intrafamiliar')
ON CONFLICT (situacion) DO NOTHING;

INSERT INTO departamentos (nombre) VALUES
    ('Amazonas'), ('Antioquia'), ('Arauca'), ('Atlántico'), ('Bogotá D.C.'),
    ('Bolívar'), ('Boyacá'), ('Caldas'), ('Caquetá'), ('Casanare'),
    ('Cauca'), ('Cesar'), ('Chocó'), ('Córdoba'), ('Cundinamarca'),
    ('Guainía'), ('Guaviare'), ('Huila'), ('La Guajira'), ('Magdalena'),
    ('Meta'), ('Nariño'), ('Norte de Santander'), ('Putumayo'), ('Quindío'),
    ('Risaralda'), ('San Andrés y Providencia'), ('Santander'), ('Sucre'),
    ('Tolima'), ('Valle del Cauca'), ('Vaupés'), ('Vichada')
ON CONFLICT (nombre) DO NOTHING;

-- Para cuantificar la tierra o el predio abandonado por desplazamiento.
INSERT INTO unidades_medida (nombre) VALUES
    ('Hectáreas'),
    ('Fanegadas'),
    ('Metros cuadrados')
ON CONFLICT (nombre) DO NOTHING;

-- =====================================================================
-- Roles y permisos (HU6, HU7)
-- =====================================================================

CREATE TABLE IF NOT EXISTS roles (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(50) NOT NULL UNIQUE,
    descripcion    VARCHAR(255),
    es_sistema     BOOLEAN NOT NULL DEFAULT FALSE, -- No se puede eliminar ni renombrar
    es_admin       BOOLEAN NOT NULL DEFAULT FALSE, -- Tiene todos los permisos siempre
    es_registro    BOOLEAN NOT NULL DEFAULT FALSE, -- Rol que reciben quienes se registran solos
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catálogo fijo: cada permiso corresponde a una funcionalidad del código
CREATE TABLE IF NOT EXISTS permisos (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50) NOT NULL UNIQUE,
    nombre      VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255),
    modulo      VARCHAR(50) NOT NULL,
    orden       INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles_permisos (
    rol_id     INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

-- Tarjetas del panel y su visibilidad por rol (HU8)
CREATE TABLE IF NOT EXISTS tarjetas (
    id             SERIAL PRIMARY KEY,
    codigo         VARCHAR(50) NOT NULL UNIQUE,
    nombre         VARCHAR(100) NOT NULL,
    descripcion    VARCHAR(255),
    ruta           VARCHAR(100) NOT NULL,
    permiso_codigo VARCHAR(50) NOT NULL, -- Además de estar visible, el usuario necesita este permiso
    orden          INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles_tarjetas (
    rol_id     INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tarjeta_id INT NOT NULL REFERENCES tarjetas(id) ON DELETE CASCADE,
    visible    BOOLEAN NOT NULL,
    PRIMARY KEY (rol_id, tarjeta_id)
);

-- Campos del formulario de ticket y su configuración por rol (HU9).
-- El código coincide con el nombre del campo que envía formulario.js
CREATE TABLE IF NOT EXISTS campos_formulario (
    id                  SERIAL PRIMARY KEY,
    codigo              VARCHAR(50) NOT NULL UNIQUE,
    etiqueta            VARCHAR(100) NOT NULL,
    obligatorio_defecto BOOLEAN NOT NULL DEFAULT TRUE,
    orden               INT NOT NULL DEFAULT 0
);

-- Si un rol no tiene fila para un campo, se usan los valores por defecto
-- (visible, habilitado y obligatorio según obligatorio_defecto)
CREATE TABLE IF NOT EXISTS roles_campos (
    rol_id      INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    campo_id    INT NOT NULL REFERENCES campos_formulario(id) ON DELETE CASCADE,
    visible     BOOLEAN NOT NULL,
    habilitado  BOOLEAN NOT NULL,
    obligatorio BOOLEAN NOT NULL,
    PRIMARY KEY (rol_id, campo_id)
);

-- ===== Cambios sobre tablas existentes =====

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_id INT REFERENCES roles(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE formularios ADD COLUMN IF NOT EXISTS funcionario_id INT REFERENCES usuarios(id);
ALTER TABLE formularios ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMPTZ;
ALTER TABLE formularios ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMPTZ;
ALTER TABLE formularios ADD COLUMN IF NOT EXISTS cerrado_por INT REFERENCES usuarios(id);
ALTER TABLE formularios ADD COLUMN IF NOT EXISTS observacion_cierre TEXT;

-- Los campos del formulario son configurables por rol, así que pueden quedar vacíos
ALTER TABLE formularios ALTER COLUMN nombre DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN tipo_identificacion_id DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN numero_identificacion DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN genero_id DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN telefono DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN situacion_id DROP NOT NULL;
ALTER TABLE formularios ALTER COLUMN departamento_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_formularios_funcionario ON formularios(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_formularios_numero_id ON formularios(numero_identificacion);

-- ===== Gestión de tickets (HU11, HU12) =====

CREATE TABLE IF NOT EXISTS ticket_comentarios (
    id            SERIAL PRIMARY KEY,
    formulario_id INT NOT NULL REFERENCES formularios(id) ON DELETE CASCADE,
    usuario_id    INT NOT NULL REFERENCES usuarios(id),
    comentario    TEXT NOT NULL,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_historial (
    id            SERIAL PRIMARY KEY,
    formulario_id INT NOT NULL REFERENCES formularios(id) ON DELETE CASCADE,
    usuario_id    INT REFERENCES usuarios(id),
    accion        VARCHAR(50) NOT NULL,
    detalle       TEXT,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comentarios_ticket ON ticket_comentarios(formulario_id);
CREATE INDEX IF NOT EXISTS idx_historial_ticket ON ticket_historial(formulario_id);

-- ===== Catálogos de permisos, tarjetas y campos =====
-- Se actualizan en cada arranque para reflejar los textos del código

INSERT INTO permisos (codigo, nombre, descripcion, modulo, orden) VALUES
    ('tickets.crear',           'Crear tickets',               'Registrar solicitudes con el formulario de ayuda',             'Tickets',        1),
    ('tickets.ver_propios',     'Consultar mis tickets',       'Ver los tickets que el usuario creó',                          'Tickets',        2),
    ('tickets.ver_todos',       'Consultar todos los tickets', 'Acceder a la bandeja con los tickets de todos los usuarios',   'Tickets',        3),
    ('tickets.cambiar_estado',  'Cambiar estado de tickets',   'Mover un ticket entre Pendiente, En proceso y Resuelto',       'Tickets',        4),
    ('tickets.asignar',         'Asignar tickets',             'Elegir el funcionario responsable de un ticket',               'Tickets',        5),
    ('tickets.comentar',        'Comentar tickets',            'Agregar información adicional a un ticket',                    'Tickets',        6),
    ('tickets.ver_historial',   'Consultar historial',         'Ver las acciones realizadas sobre un ticket',                  'Tickets',        7),
    ('tickets.cerrar',          'Cerrar y reabrir tickets',    'Finalizar la atención de un ticket o modificar uno cerrado',   'Tickets',        8),
    ('encuestas.responder',     'Responder encuestas',         'Evaluar la atención recibida',                                 'Tickets',        9),
    ('beneficiarios.consultar', 'Consultar beneficiarios',     'Buscar beneficiarios y ver su información',                    'Gestión',        10),
    ('estadisticas.ver',        'Consultar estadísticas',      'Ver el resumen estadístico de los tickets',                    'Gestión',        11),
    ('modelado.ver',            'Modelado y simulación',       'Proyectar la demanda con modelos determinísticos y estocásticos', 'Gestión',     12),
    ('usuarios.gestionar',      'Gestionar usuarios',          'Crear, editar y desactivar usuarios',                          'Administración', 13),
    ('roles.gestionar',         'Gestionar roles y permisos',  'Configurar roles, permisos, tarjetas y campos del formulario', 'Administración', 14)
ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, modulo = EXCLUDED.modulo, orden = EXCLUDED.orden;

INSERT INTO tarjetas (codigo, nombre, descripcion, ruta, permiso_codigo, orden) VALUES
    ('crear_ticket',  'Crear ticket',       'Cuéntanos tu situación y te orientamos',  '/formulario',     'tickets.crear',           1),
    ('mis_tickets',   'Mis tickets',        'Consulta el estado de tus solicitudes',   '/validar',        'tickets.ver_propios',     2),
    ('bandeja',       'Bandeja de tickets', 'Atiende, asigna y cierra solicitudes',    '/gestion',        'tickets.ver_todos',       3),
    ('beneficiarios', 'Beneficiarios',      'Busca personas y revisa sus solicitudes', '/beneficiarios',  'beneficiarios.consultar', 4),
    ('estadisticas',  'Estadísticas',       'Resumen del estado de las solicitudes',   '/estadisticas',   'estadisticas.ver',        5),
    ('modelado',      'Modelado',           'Simula la demanda y la capacidad de atención', '/modelado', 'modelado.ver',          6),
    ('usuarios',      'Usuarios',           'Crea funcionarios y administra cuentas',  '/admin/usuarios', 'usuarios.gestionar',      7),
    ('roles',         'Roles y permisos',   'Define qué puede ver y hacer cada rol',   '/admin/roles',    'roles.gestionar',         8)
ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, ruta = EXCLUDED.ruta,
    permiso_codigo = EXCLUDED.permiso_codigo, orden = EXCLUDED.orden;

INSERT INTO campos_formulario (codigo, etiqueta, obligatorio_defecto, orden) VALUES
    ('nombre',       'Nombre completo',          TRUE,  1),
    ('genero',       'Género',                   TRUE,  2),
    ('tipoId',       'Tipo de identificación',   TRUE,  3),
    ('numeroId',     'Número de identificación', TRUE,  4),
    ('telefono',     'Teléfono',                 TRUE,  5),
    ('situacionId',  'Situación',                TRUE,  6),
    ('departamento', 'Departamento',             TRUE,  7),
    ('unidadMedida', 'Unidad de medida',         FALSE, 8),
    ('cantidad',     'Cantidad',                 FALSE, 9)
ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta, orden = EXCLUDED.orden;

-- ===== Roles iniciales =====
-- Solo la primera vez: después los permisos los administra el Administrador
-- y no deben sobrescribirse en cada arranque

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM roles) THEN
        INSERT INTO roles (nombre, descripcion, es_sistema, es_admin, es_registro) VALUES
            ('Administrador', 'Acceso total al sistema y a su configuración', TRUE, TRUE,  FALSE),
            ('Funcionario',   'Atiende y gestiona las solicitudes',           TRUE, FALSE, FALSE),
            ('Usuario',       'Persona que solicita orientación',             TRUE, FALSE, TRUE);

        INSERT INTO roles_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r JOIN permisos p ON
            (r.nombre = 'Usuario' AND p.codigo IN (
                'tickets.crear', 'tickets.ver_propios', 'tickets.comentar',
                'tickets.ver_historial', 'encuestas.responder'))
         OR (r.nombre = 'Funcionario' AND p.codigo IN (
                'tickets.ver_todos', 'tickets.cambiar_estado', 'tickets.asignar', 'tickets.comentar',
                'tickets.ver_historial', 'tickets.cerrar', 'beneficiarios.consultar'));

        INSERT INTO roles_tarjetas (rol_id, tarjeta_id, visible)
        SELECT r.id, t.id, TRUE FROM roles r JOIN tarjetas t ON
            (r.nombre = 'Usuario' AND t.codigo IN ('crear_ticket', 'mis_tickets'))
         OR (r.nombre = 'Funcionario' AND t.codigo IN ('bandeja', 'beneficiarios'));
    END IF;
END $$;

-- Los usuarios creados antes de existir los roles quedan con el rol de registro
UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE es_registro ORDER BY id LIMIT 1)
WHERE rol_id IS NULL;

-- =====================================================================
-- Minería de datos
-- =====================================================================

-- Cada encuesta queda ligada al ticket que evalúa
ALTER TABLE encuestas_satisfaccion ADD COLUMN IF NOT EXISTS formulario_id INT REFERENCES formularios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_encuestas_ticket ON encuestas_satisfaccion(formulario_id);

-- Una fila por ticket con todas sus variables, lista para exportar y analizar.
-- Las fechas se expresan en hora de Colombia.
DROP VIEW IF EXISTS vista_mineria_tickets;
CREATE VIEW vista_mineria_tickets AS
WITH historial AS (
    SELECT formulario_id,
           MIN(fecha) FILTER (WHERE accion = 'Asignación') AS primera_asignacion,
           COUNT(*) FILTER (WHERE accion = 'Asignación') AS asignaciones,
           COUNT(*) FILTER (WHERE accion = 'Reapertura') AS reaperturas
    FROM ticket_historial
    GROUP BY formulario_id
),
comentarios AS (
    SELECT c.formulario_id,
           COUNT(*) AS comentarios,
           COUNT(*) FILTER (WHERE c.usuario_id = f.usuario_id) AS comentarios_solicitante
    FROM ticket_comentarios c
    JOIN formularios f ON f.id = c.formulario_id
    GROUP BY c.formulario_id
)
SELECT
    f.id AS ticket_id,
    f.usuario_id,
    s.situacion,
    d.nombre AS departamento,
    g.descripcion AS genero,
    ti.descripcion AS tipo_identificacion,
    (f.fecha_creacion AT TIME ZONE 'America/Bogota') AS fecha_creacion,
    EXTRACT(YEAR FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS anio,
    EXTRACT(MONTH FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS mes,
    EXTRACT(ISODOW FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS dia_semana,
    EXTRACT(HOUR FROM f.fecha_creacion AT TIME ZONE 'America/Bogota')::int AS hora,
    f.estado,
    f.funcionario_id,
    NULLIF(CONCAT_WS(' ', fu.nombre, fu.apellido), '') AS funcionario,
    um.nombre AS unidad_medida,
    f.cantidad,
    -- Tierra abandonada en hectáreas (1 fanegada ≈ 0,64 ha)
    ROUND(CASE um.nombre
        WHEN 'Hectáreas' THEN f.cantidad
        WHEN 'Fanegadas' THEN f.cantidad * 0.64
        WHEN 'Metros cuadrados' THEN f.cantidad / 10000.0
    END, 4) AS hectareas,
    ROUND((EXTRACT(EPOCH FROM h.primera_asignacion - f.fecha_creacion) / 3600)::numeric, 2) AS horas_hasta_asignacion,
    ROUND((EXTRACT(EPOCH FROM f.fecha_cierre - f.fecha_creacion) / 86400)::numeric, 2) AS dias_hasta_cierre,
    COALESCE(h.asignaciones, 0)::int AS asignaciones,
    COALESCE(h.reaperturas, 0)::int AS reaperturas,
    COALESCE(c.comentarios, 0)::int AS comentarios,
    COALESCE(c.comentarios_solicitante, 0)::int AS comentarios_solicitante,
    (SELECT COUNT(*) FROM formularios p
     WHERE p.usuario_id = f.usuario_id AND p.fecha_creacion < f.fecha_creacion)::int AS tickets_previos_usuario,
    e.id IS NOT NULL AS tiene_encuesta,
    e.calificacion,
    e.satisfaccion,
    e.rapidez,
    e.amabilidad,
    e.claridad,
    e.utilidad,
    e.recomienda,
    e.fuente
FROM formularios f
LEFT JOIN situaciones s ON s.id = f.situacion_id
LEFT JOIN departamentos d ON d.id = f.departamento_id
LEFT JOIN generos g ON g.id = f.genero_id
LEFT JOIN tipos_identificacion ti ON ti.id = f.tipo_identificacion_id
LEFT JOIN unidades_medida um ON um.id = f.unidad_medida_id
LEFT JOIN usuarios fu ON fu.id = f.funcionario_id
LEFT JOIN historial h ON h.formulario_id = f.id
LEFT JOIN comentarios c ON c.formulario_id = f.id
LEFT JOIN LATERAL (
    SELECT * FROM encuestas_satisfaccion es
    WHERE es.formulario_id = f.id
    ORDER BY es.fecha_creacion DESC
    LIMIT 1
) e ON TRUE;
