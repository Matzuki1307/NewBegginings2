# New Beginnings

Plataforma web que orienta a víctimas de **desplazamiento forzado**, **violencia contra la mujer** y **maltrato intrafamiliar** en Colombia. La persona cuenta su caso en un formulario, recibe un ticket de seguimiento y se le dirige a la entidad adecuada (Defensoría del Pueblo, Línea Púrpura o ICBF).

## Funcionalidades

- Registro e inicio de sesión (contraseñas cifradas con bcrypt, sesiones guardadas en Postgres)
- Formulario de caso con catálogos dinámicos (situación, departamento, tipo de documento…)
- Generación de tickets y consulta de "mis tickets"
- Encuesta de satisfacción

## Tecnologías

Node.js · Express 5 · PostgreSQL · Tailwind CSS · Docker · GitHub Actions · Render

## Correr en local

Requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Abre http://localhost:3000. La primera vez se crean las tablas y se cargan los catálogos desde [`DB/init.sql`](DB/init.sql).

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
server.js            Rutas y API (Express)
DB/db.js             Conexión a Postgres e inicialización
DB/init.sql          Esquema + datos de catálogo (idempotente)
template/            Páginas HTML
public/assets/       CSS, JS e imágenes
.github/workflows/   CI (pruebas con Docker Compose) y despliegue
```

## Despliegue (Render + Neon)

1. **Base de datos:** crea un proyecto gratis en [Neon](https://neon.tech) y copia la *connection string* (termina en `?sslmode=require`).
2. **App:** en [Render](https://render.com) crea un *Web Service* desde este repositorio:
   - Runtime: **Docker**
   - Variables de entorno:
     - `DATABASE_URL` = la URL de Neon
     - `SESSION_SECRET` = una cadena larga y aleatoria
   - Health check path: `/health`
   - Auto-Deploy: **Off** (despliega GitHub Actions cuando pasan las pruebas)
3. **CI/CD:** en Render, *Settings → Deploy Hook*, copia la URL y guárdala en GitHub como secret `RENDER_DEPLOY_HOOK_URL` (*Settings → Secrets and variables → Actions*).

Cada push a `main` ejecuta las pruebas y, si pasan, despliega.

> En el plan gratuito, Render apaga la app tras 15 minutos sin tráfico y tarda unos 30–50 s en despertar. Ábrela un poco antes de una demo.
