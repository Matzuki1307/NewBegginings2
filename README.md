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
- Estadísticas y KPI: los 13 indicadores del documento de KPI con su meta y su estado (cumple, en riesgo, no cumple), y gráficas de volumen, tiempos de atención, satisfacción y territorio, filtrables por periodo

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

## Datos de demostración y minería de datos

[`scripts/seed-demo.js`](scripts/seed-demo.js) genera un dataset **sintético** (personas ficticias) con dos años de historia: unos 6000 tickets, 5400 solicitantes, 17 funcionarios, historial, comentarios y encuestas.

```bash
npm run seed:demo                              # 6000 tickets, semilla 2026
npm run seed:demo -- --tickets=10000 --semilla=7
npm run seed:demo -- --solo-limpiar            # borra solo los datos demo
```

Usa la `DATABASE_URL` del `.env`. Todo lo que crea pertenece a cuentas `@demo.newbeginnings.co` (contraseña `Demo1234`), así que se puede volver a ejecutar sin tocar los datos reales. Con la misma semilla siempre genera los mismos datos.

El dataset trae patrones intencionales para descubrir:

| Patrón | Dónde mirarlo |
|---|---|
| Desplazamiento concentrado en zonas de conflicto; violencia y maltrato según población | `situacion` × `departamento` |
| Eventos de desplazamiento masivo (Catatumbo ene-2025, Cauca, Chocó, Sur de Bolívar) | Picos de `fecha_creacion` por departamento; más `horas_hasta_asignacion` y `dias_hasta_cierre` |
| Más maltrato intrafamiliar en diciembre/enero y vacaciones; violencia más alta los fines de semana y de noche | `mes`, `dia_semana`, `hora` |
| Funcionarios especializados y con distinta eficiencia | `funcionario` × `dias_hasta_cierre` |
| La satisfacción baja con la demora y las reaperturas, y sube con el acompañamiento | `calificacion`, `recomienda` vs `dias_hasta_cierre`, `reaperturas`, `comentarios` |
| Personas que vuelven a pedir ayuda, sobre todo por maltrato intrafamiliar | `tickets_previos_usuario` |
| Género y documento según la situación; migrantes (PPT) en zonas de frontera | `genero`, `tipo_identificacion` × `departamento` |
| Congestión en las últimas semanas y ~2 % de casos estancados | `estado`, `dias_hasta_cierre` atípicos |

La vista **`vista_mineria_tickets`** (en [`DB/init.sql`](DB/init.sql)) tiene una fila por ticket con todas esas variables y sin datos personales. Para llevarla a Python, R, Weka o Excel:

```bash
npm run mineria:exportar          # -> mineria/tickets.csv
```

## Modelado y simulación

La sección **Modelado** (`/modelado`, permiso `modelado.ver`) trata la atención como una cola: llegan **λ** tickets por día, **c** funcionarios cierran **μ** tickets cada uno por día y lo que no se cierra queda pendiente. Los parámetros se estiman con los datos reales de los últimos 30, 90, 180 o 365 días y se pueden modificar para probar escenarios.

| Modelo | Cómo funciona | Resultado |
|---|---|---|
| **Determinístico** | `B(t+1) = máx(0, B(t) + λ − c·μ)`, sin azar | Un único valor: utilización, pendientes al final, días para vaciar y funcionarios necesarios |
| **Estocástico (Monte Carlo)** | Llegadas `~ Poisson(λ)` (o remuestreo de los días observados) y cierres `~ Poisson(c·μ)`, repetido cientos de veces con una semilla | Una distribución: mediana, intervalo del 90 % y probabilidad de que los pendientes crezcan o superen un umbral |

La página compara ambas proyecciones en una gráfica y explica la diferencia: cuando la utilización está cerca del 100 %, la variabilidad diaria genera congestión que el modelo determinístico no ve. Por defecto solo la ve el Administrador; se puede habilitar para otros roles desde **Roles y permisos**.

## Minería de datos

La sección **Minería de datos** (`/mineria`, permiso `mineria.ver`) aplica tres técnicas sobre los tickets, directamente en la plataforma y sin librerías externas. Por defecto solo la ve el Administrador; se puede habilitar para otros roles desde **Roles y permisos**.

**Todos los modelos se entrenan con el 70 % de los tickets y se evalúan con el 30 % restante**, que no se usa para entrenar. La partición usa siempre la misma semilla (2026), así que los resultados se pueden repetir. Los modelos supervisados la hacen estratificada (las dos partes conservan la misma proporción de tickets con demora).

| Pestaña | Técnica | Qué hace | Cómo se valida con el 30 % |
|---|---|---|---|
| **Grupos de casos** | k-means (inicio k-means++, 5 reinicios) | Agrupa tickets parecidos (situación, región, perfil de la persona, época, horario) y describe cada grupo y su atención | Se asignan los tickets de prueba al centro más cercano y se compara la silueta |
| **Reglas de asociación** | Eclat (conjuntos de bits) | Encuentra «si A y B, entonces C» con soporte, confianza y lift | Se mide la confianza de cada regla en los tickets de prueba; es *estable* si cambia menos de 10 puntos |
| **Riesgo de demora** | Regresión logística y árbol de decisión (CART), comparados con una línea base | Predice si un ticket superará la meta de cierre (ANS) de su situación y puntúa los tickets abiertos | AUC, exactitud, exactitud balanceada, precisión, exhaustividad y F1 sobre la prueba |

### Riesgo de demora

- **Qué se predice:** el ticket tiene demora si se cierra después del ANS de su situación (5 días violencia contra la mujer, 10 maltrato intrafamiliar, 20 desplazamiento forzado), la misma meta del KPI K3 ([`lib/ans.js`](lib/ans.js)).
- **Solo se entrena con tickets cuyo plazo ya venció.** Así la etiqueta es cierta: cerrado a tiempo, cerrado tarde o abierto pasada la meta. Un ticket reciente que sigue abierto se deja fuera, porque aún podría cerrarse a tiempo; incluirlo como «a tiempo» sesgaría el modelo.
- **Dos variantes**, porque lo que se sabe cambia con el tiempo: *al crear el ticket* (situación, departamento, perfil, fecha y hora, congestión del sistema, demanda reciente en el departamento y solicitudes previas) y *con responsable asignado* (suma el responsable y las horas que tardó la asignación). Con los datos de demostración el AUC de prueba pasa de ≈ 0,63 a ≈ 0,77: asignar rápido y bien es lo que más ayuda a cumplir la meta.
- **Sin trampas:** los ajustes de cada modelo (penalización de la regresión, profundidad del árbol) se eligen con una quinta parte del propio entrenamiento; las variables numéricas se estandarizan con datos de entrenamiento; la importancia de cada variable se mide por permutación sobre la prueba.
- **Tickets abiertos:** los vencidos se listan aparte; los que aún están a tiempo reciben una probabilidad (riesgo bajo < 50 %, medio 50–70 %, alto ≥ 70 %) y los motivos que más la empujan. La página muestra qué pasó realmente con cada nivel en los tickets de prueba.
- **Límites:** es una ayuda para priorizar, no un veredicto. No conoce la carga real de cada funcionario. Con pocos tickets los resultados cambian mucho entre particiones, y los datos de demostración son sintéticos.

### Detalles de implementación

- Los cálculos están en [`lib/analitica/`](lib/analitica) (`datos.js` carga y prepara, `grupos.js`, `reglas.js` y `riesgo.js` son los análisis) y la API en [`routes/mineria.js`](routes/mineria.js): `GET /api/mineria/grupos?k=auto|2..8`, `/reglas?soporte=&confianza=` y `/riesgo`.
- Cada resultado se guarda 10 minutos en memoria; el botón *Actualizar datos* fuerza un nuevo cálculo (como máximo cada 30 segundos). Si hay pocos tickets, cada pestaña explica qué falta en lugar de mostrar resultados engañosos.
- No se muestran datos personales: solo número de ticket, situación, departamento, estado y tiempos. Los responsables aparecen como «Funcionario n.º X».
- Pruebas: `npm test` (Node ≥ 20, sin dependencias) verifica la partición 70/30, las etiquetas, el AUC, las métricas, los soportes y confianzas de las reglas, los grupos y el modelo de riesgo con datos sintéticos de respuesta conocida. El CI también llama a la API con una base real.

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
routes/              API: auth, catálogos, tickets, reportes (beneficiarios y estadísticas), modelado, minería, admin
middleware/auth.js   Carga del usuario con su rol y permisos; protección de páginas y API
lib/                 Validaciones, metas ANS y configuración de tarjetas/campos por rol
lib/analitica/       Minería de datos: grupos (k-means), reglas (Eclat) y riesgo de demora
test/                Pruebas de la minería de datos (npm test)
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
