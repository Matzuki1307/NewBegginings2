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
