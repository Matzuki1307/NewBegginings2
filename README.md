# New Beginnings

Plataforma web que orienta a víctimas de **desplazamiento forzado**, **violencia contra la mujer** y **maltrato intrafamiliar** en Colombia. La persona cuenta su caso en un formulario, recibe un ticket de seguimiento y los funcionarios lo atienden hasta cerrarlo, dirigiéndola a la entidad adecuada (Defensoría del Pueblo, Línea Púrpura o ICBF).

## Funcionalidades

**Usuarios (solicitantes)**
- Registro e inicio de sesión (contraseñas cifradas con bcrypt, sesiones guardadas en Postgres)
- Formulario de caso con catálogos dinámicos (situación, departamento, tipo de documento…)
- Consulta de "mis tickets", detalle con comentarios e historial, y encuesta de satisfacción

**Funcionarios**
- Bandeja con los tickets de todos los usuarios, con búsqueda y filtros
- Cambio de estado, asignación de responsable, cierre con observación, comentarios e historial
- Búsqueda de beneficiarios por nombre o documento

**Administración**
- Gestión de usuarios: crear funcionarios, editar, activar y desactivar
- Roles configurables: permisos, tarjetas visibles en el panel y campos del formulario (visible, habilitado, obligatorio) por rol
- Estadísticas de los tickets

Cada funcionalidad corresponde a una historia de usuario (HU1–HU15) del documento de referencia.

## Roles y permisos

Al crear la base se cargan tres roles del sistema, que no se pueden eliminar ni renombrar:

| Rol | Puede |
|---|---|
| **Administrador** | Todo, siempre (sus permisos no se pueden quitar) |
| **Funcionario** | Bandeja, cambiar estado, asignar, comentar, ver historial, cerrar, consultar beneficiarios |
| **Usuario** | Crear tickets, ver los suyos, comentar, ver historial, responder la encuesta. Es el rol que reciben quienes se registran solos |

Desde **Roles y permisos** el administrador puede cambiar esto o crear roles nuevos. Los cambios aplican de inmediato, sin que el usuario tenga que volver a iniciar sesión. Cada página y cada endpoint de la API verifica el permiso en el servidor.

Estados de un ticket: `Pendiente → En proceso → Resuelto → Cerrado`. Para cerrar hacen falta un responsable asignado y una observación; un ticket cerrado solo lo puede modificar (reabrir) quien tiene el permiso de cerrar.

### Primer administrador

Se crea al arrancar a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD` si ese correo no existe. En local (Docker Compose) es:

- Correo: `admin@newbeginnings.local`
- Contraseña: `Admin1234`

Con él se crean las cuentas de los funcionarios en **Usuarios**.

## Tecnologías

Node.js · Express 5 · PostgreSQL · Tailwind CSS · Docker · GitHub Actions · Render

## Correr en local

Requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Abre http://localhost:3000. Al arrancar se crean o actualizan las tablas y se cargan los catálogos desde [`DB/init.sql`](DB/init.sql).

Para borrar la base de datos y empezar de cero:

```bash
docker compose down -v
```

### Sin Docker para la app

```bash
docker compose up -d db     # solo Postgres
cp .env.example .env
npm install
npm start
```

## Estructura

```
server.js            Configuración de Express y rutas de las páginas
routes/              API: auth, catálogos, tickets, reportes (beneficiarios y estadísticas), admin
middleware/auth.js   Carga del usuario con su rol y permisos; protección de páginas y API
lib/                 Validaciones y configuración de tarjetas/campos por rol
DB/db.js             Conexión a Postgres, inicialización y administrador inicial
DB/init.sql          Esquema, catálogos y roles iniciales (idempotente)
template/            Páginas HTML
public/assets/       CSS, JS (app.js tiene las utilidades compartidas) e imágenes
.github/workflows/   CI (pruebas con Docker Compose) y despliegue
```

## Despliegue (Render + Neon)

1. **Base de datos:** crea un proyecto gratis en [Neon](https://neon.tech) y copia la *connection string* (con `?sslmode=verify-full`).
2. **App:** en [Render](https://render.com) crea un *Web Service* desde este repositorio:
   - Runtime: **Docker**, rama `main`
   - Variables de entorno:
     - `DATABASE_URL` = la URL de Neon
     - `SESSION_SECRET` = una cadena larga y aleatoria
     - `ADMIN_EMAIL` y `ADMIN_PASSWORD` = el primer administrador (contraseña con mínimo 8 caracteres, una mayúscula y un número)
   - Health check path: `/health`
   - Auto-Deploy: **After CI Checks Pass** (despliega cuando GitHub Actions aprueba el commit)

> En el plan gratuito, Render apaga la app tras 15 minutos sin tráfico y tarda unos 30–50 s en despertar. Ábrela un poco antes de una demo.
