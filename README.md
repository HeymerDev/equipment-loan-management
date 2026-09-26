# Préstamo de equipos tecnológicos

Aplicación web para que los docentes de un colegio pidan prestados equipos (portátiles,
proyectores, tabletas…) y el administrador apruebe, entregue y reciba cada préstamo. Cada
préstamo genera un comprobante en PDF, y todo lo que ocurre queda en un historial de solo
lectura.

- [Cómo funciona](#cómo-funciona)
- [Inicio rápido](#inicio-rápido)
- [Pantallas por rol](#pantallas-por-rol)
- [Usar la API](#usar-la-api)
- [Referencia de endpoints](#referencia-de-endpoints)
- [Reglas del negocio](#reglas-del-negocio)
- [Pruebas](#pruebas)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Decisiones técnicas](#decisiones-técnicas)
- [Limitaciones conocidas](#limitaciones-conocidas)

## Cómo funciona

Hay dos roles: **administrador** y **docente**.

1. El administrador registra las **categorías**, los **equipos** y las **cuentas** de los
   docentes.
2. El docente busca un equipo disponible y envía una **solicitud** con el propósito y las
   fechas.
3. El administrador la **aprueba** o la **rechaza** (con motivo). Al aprobarla se crea el
   **préstamo**, el equipo pasa a prestado y se genera el comprobante PDF.
4. Cuando el docente devuelve el equipo, el administrador registra la **devolución** y el
   equipo vuelve a estar disponible.

Una solicitud pasa por estos estados:

```mermaid
stateDiagram-v2
    [*] --> PENDIENTE: el docente la crea
    PENDIENTE --> APROBADA: el administrador la aprueba
    PENDIENTE --> RECHAZADA: el administrador la rechaza
    PENDIENTE --> CANCELADA: el docente la cancela
    PENDIENTE --> CANCELADA: se aprobó otra con fechas cruzadas
    APROBADA --> [*]
    RECHAZADA --> [*]
    CANCELADA --> [*]
```

Y el préstamo que nace de una solicitud aprobada:

```mermaid
stateDiagram-v2
    [*] --> ACTIVO: solicitud aprobada (equipo PRESTADO)
    ACTIVO --> FINALIZADO: devolución registrada (equipo DISPONIBLE)
    FINALIZADO --> [*]
```

## Inicio rápido

**Requisitos:** Node 20 o superior, pnpm 9 y una base de datos PostgreSQL (local, en Docker
o en un servicio como Neon).

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar la API

Crea el archivo `apps/api/.env`:

```dotenv
DATABASE_URL="postgresql://usuario:contraseña@localhost:5432/prestamos"
JWT_SECRET="una-cadena-larga-y-aleatoria-de-al-menos-16"
JWT_REFRESH_SECRET="otra-cadena-distinta-de-al-menos-16"
PORT=3001
INSTITUTION_NAME="Colegio San José"
APP_TIMEZONE="America/Bogota"
```

Para generar secretos aleatorios:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `JWT_SECRET` | Sí | Firma el token de acceso. Mínimo 16 caracteres |
| `JWT_REFRESH_SECRET` | Sí | Firma el token de refresco. Mínimo 16 caracteres y distinto del anterior |
| `PORT` | No | Puerto de la API. Por defecto `3001` |
| `INSTITUTION_NAME` | No | Nombre impreso en el comprobante. Por defecto `Institución Educativa` |
| `APP_TIMEZONE` | No | Zona horaria IANA de la hora impresa en el comprobante. Por defecto, la del servidor |
| `TEST_DATABASE_URL` | Solo pruebas | Base desechable para la suite de integración |

Si falta una variable obligatoria, la API no arranca y dice cuál es.

### 3. Crear las tablas y los datos iniciales

```bash
pnpm --filter @equipment-loan/api db:migrate   # crea o actualiza las tablas
pnpm --filter @equipment-loan/api db:seed      # 2 usuarios y 3 categorías
```

`db:migrate` usa `prisma migrate dev`, pensado para desarrollo. En una base que ya está en
uso (staging o producción), aplica las migraciones pendientes sin generar nuevas:

```bash
pnpm --filter @equipment-loan/api exec prisma migrate deploy
```

### 4. Arrancar

```bash
pnpm dev
```

| Servicio | Dirección |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Estado de la API | http://localhost:3001/health → `{"status":"ok"}` |

Si la API está en otra dirección, indícaselo a la web en `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:3001/api/v1"
```

### 5. Entrar

El seed crea estas cuentas:

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@school.com` | `password123` |
| Docente | `docente@school.com` | `password123` |

Son solo para desarrollo: están escritas en claro en `apps/api/prisma/seed.ts`.

## Pantallas por rol

Al iniciar sesión, cada rol llega a su página de inicio. Si alguien abre una ruta de otro rol,
ve una pantalla de acceso denegado.

**Administrador** (inicio: `/dashboard`)

| Ruta | Para qué sirve |
|---|---|
| `/dashboard` | Resumen: solicitudes pendientes, préstamos activos y vencidos, equipos disponibles |
| `/inventory` | Registrar, editar y retirar equipos; ver el historial de cada uno |
| `/requests` | Aprobar o rechazar solicitudes. Se actualiza sola cada 30 segundos |
| `/loans` | Préstamos activos y finalizados, registrar devoluciones, descargar el comprobante |
| `/history` | Historial completo, con filtros por tipo, fechas, equipo y usuario |
| `/categories` | Crear, renombrar y eliminar categorías |
| `/users` | Registrar docentes y administradores |

**Docente** (inicio: `/my-requests`)

| Ruta | Para qué sirve |
|---|---|
| `/equipment` | Catálogo de equipos disponibles |
| `/my-requests` | Sus solicitudes y su estado; cancelar las pendientes |
| `/my-requests/new` | Crear una solicitud |

**Cualquier rol:** `/change-password` para cambiar la contraseña. Quien entra por primera vez
con una contraseña temporal solo puede ver esta pantalla hasta cambiarla.

## Usar la API

Todas las rutas empiezan por `/api/v1` y hablan JSON. Los ejemplos usan `curl` con sintaxis de
bash; en Windows puedes ejecutarlos desde Git Bash.

### Iniciar sesión

```bash
curl -s -c cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@school.com","password":"password123"}'
```

```json
{ "data": { "accessToken": "eyJhbGciOiJIUzI1NiIs…", "mustChangePassword": false } }
```

La respuesta trae el **token de acceso**, que dura 15 minutos. Además, la API deja el
**token de refresco**, que dura 7 días, en una cookie `HttpOnly`; `-c cookies.txt` la guarda.

Guarda el token para las siguientes peticiones:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIs…"
```

Y envíalo en la cabecera `Authorization`:

```bash
curl -s http://localhost:3001/api/v1/categories -H "Authorization: Bearer $TOKEN"
```

Cuando el token de acceso caduca, pide otro con la cookie:

```bash
curl -s -b cookies.txt -X POST http://localhost:3001/api/v1/auth/refresh
```

### Formato de las respuestas

Un solo elemento:

```json
{ "data": { "id": "…", "name": "Proyección", "equipmentCount": 0 } }
```

Una lista paginada:

```json
{
  "data": [ { "…": "…" } ],
  "meta": { "page": 1, "limit": 50, "total": 128 }
}
```

Un error. `field` aparece cuando el problema es un campo concreto, y `details` cuando la
validación encuentra varios:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La fecha de inicio no puede ser en el pasado",
    "field": "startDate"
  }
}
```

| Código HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Datos inválidos o que rompen una regla del negocio |
| 401 | `UNAUTHORIZED` | Sin token, token inválido o caducado, o credenciales incorrectas |
| 403 | `FORBIDDEN` | El rol no puede hacer esa acción |
| 403 | `PASSWORD_CHANGE_REQUIRED` | La cuenta aún tiene la contraseña temporal |
| 404 | `NOT_FOUND` | El recurso no existe |
| 409 | `CONFLICT` | Choca con el estado actual: nombre o serie repetidos, equipo ocupado… |
| 500 | `INTERNAL_ERROR` | Error inesperado del servidor |

### Recorrido completo: de la solicitud a la devolución

**1. Registrar un equipo** (administrador). El `categoryId` sale de `GET /categories`.

```bash
curl -s -X POST http://localhost:3001/api/v1/equipment \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Proyector Epson X41",
    "serialNumber": "EPX41-0007",
    "description": "Con cable HDMI y control remoto",
    "categoryId": "c1d2e3f4-…"
  }'
```

```json
{
  "data": {
    "id": "5b0f…",
    "name": "Proyector Epson X41",
    "serialNumber": "EPX41-0007",
    "description": "Con cable HDMI y control remoto",
    "status": "DISPONIBLE",
    "categoryId": "c1d2e3f4-…",
    "categoryName": "Proyección",
    "createdAt": "2026-10-01T14:03:11.000Z",
    "updatedAt": "2026-10-01T14:03:11.000Z"
  }
}
```

**2. Solicitar el equipo** (docente, con su propio token). Las fechas son días `AAAA-MM-DD`.

```bash
curl -s -X POST http://localhost:3001/api/v1/loan-requests \
  -H "Authorization: Bearer $TOKEN_DOCENTE" -H "Content-Type: application/json" \
  -d '{
    "equipmentId": "5b0f…",
    "purpose": "Presentación de ciencias con 10-B",
    "startDate": "2026-10-05",
    "returnDate": "2026-10-07"
  }'
```

La solicitud se crea en estado `PENDIENTE`. Si el equipo ya está prestado en alguno de esos
días, la API responde `409` con `"El equipo no está disponible en el período solicitado"`.

**3. Ver la cola y aprobar** (administrador).

```bash
curl -s "http://localhost:3001/api/v1/loan-requests?status=PENDIENTE" \
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:3001/api/v1/loan-requests/9a7e…/approve \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "request": { "id": "9a7e…", "status": "APROBADA", "…": "…" },
    "loan": {
      "id": "e41c…",
      "status": "ACTIVO",
      "startDate": "2026-10-05T00:00:00.000Z",
      "agreedReturnDate": "2026-10-07T00:00:00.000Z",
      "equipmentId": "5b0f…",
      "requestId": "9a7e…"
    },
    "autoCancelledRequestIds": [],
    "pdfGenerated": true,
    "pdfUrl": "/api/v1/loans/e41c…/pdf"
  }
}
```

Si el préstamo se creó pero el PDF falló, la respuesta es `207` con `"pdfGenerated": false` y
un campo `warning`. El préstamo es válido igual, y el comprobante se puede volver a pedir.

Para rechazar, el motivo debe tener entre 10 y 500 caracteres:

```bash
curl -s -X POST http://localhost:3001/api/v1/loan-requests/9a7e…/reject \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"rejectionReason":"El proyector está reservado para el acto del viernes"}'
```

**4. Descargar el comprobante.**

```bash
curl -s -o comprobante.pdf http://localhost:3001/api/v1/loans/e41c…/pdf \
  -H "Authorization: Bearer $TOKEN"
```

**5. Registrar la devolución.** Las observaciones son opcionales, hasta 500 caracteres.

```bash
curl -s -X POST http://localhost:3001/api/v1/loans/e41c…/return \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"returnNotes":"Devuelto completo, sin daños"}'
```

La respuesta incluye `"status": "FINALIZADO"`, `returnedLate` y, si hubo retraso, `daysLate`.

**6. Consultar el historial.** Los filtros se combinan entre sí:

```bash
curl -s "http://localhost:3001/api/v1/history?equipmentId=5b0f…&startDate=2026-10-01&endDate=2026-10-31" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    { "id": "…", "eventType": "LOAN_RETURNED", "entityTable": "Loan", "userId": "…",
      "occurredAt": "2026-10-07T16:40:02.000Z", "equipmentId": "5b0f…", "loanId": "e41c…" },
    { "id": "…", "eventType": "LOAN_STARTED", "…": "…" },
    { "id": "…", "eventType": "REQUEST_APPROVED", "…": "…" }
  ],
  "meta": { "page": 1, "limit": 100, "total": 5 }
}
```

### Registrar un docente

```bash
curl -s -X POST http://localhost:3001/api/v1/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fullName":"María Ruiz","email":"maria.ruiz@colegio.edu","role":"DOCENTE"}'
```

```json
{
  "data": {
    "user": { "id": "…", "email": "maria.ruiz@colegio.edu", "fullName": "María Ruiz", "role": "DOCENTE" },
    "temporaryPassword": "k7PqRm2xWz9T"
  }
}
```

La contraseña temporal solo aparece en esta respuesta; no se puede volver a consultar. Con ella,
María inicia sesión, pero cualquier otra ruta le responde `403 PASSWORD_CHANGE_REQUIRED` hasta
que la cambie:

```bash
curl -s -b cookies.txt -X POST http://localhost:3001/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN_MARIA" -H "Content-Type: application/json" \
  -d '{"currentPassword":"k7PqRm2xWz9T","newPassword":"mi-clave-nueva"}'
```

La respuesta es `204`. Después hay que pedir un token nuevo con `/auth/refresh`, porque el
anterior todavía dice que la contraseña es temporal.

## Referencia de endpoints

"Autenticado" significa cualquier rol con sesión. La columna **Página** indica el máximo por
página (`?limit=`) y el valor por defecto.

| Método y ruta | Quién | Qué hace | Página |
|---|---|---|---|
| `POST /auth/login` | Público | Inicia sesión | — |
| `POST /auth/refresh` | Cookie | Renueva el token de acceso | — |
| `POST /auth/logout` | Autenticado | Cierra la sesión | — |
| `POST /auth/change-password` | Autenticado | Cambia la propia contraseña y cierra las demás sesiones | — |
| `GET /categories` | Autenticado | Lista las categorías, con cuántos equipos activos tiene cada una | — |
| `POST /categories` | Administrador | Crea una categoría | — |
| `PATCH /categories/:id` | Administrador | Renombra una categoría | — |
| `DELETE /categories/:id` | Administrador | Elimina una categoría sin equipos | — |
| `GET /equipment` | Autenticado | Lista el inventario. Filtro: `?status=DISPONIBLE\|PRESTADO` | 50 (50) |
| `GET /equipment/:id` | Autenticado | Detalle de un equipo | — |
| `POST /equipment` | Administrador | Registra un equipo | — |
| `PATCH /equipment/:id` | Administrador | Edita uno o más campos | — |
| `DELETE /equipment/:id` | Administrador | Retira un equipo del inventario | — |
| `GET /equipment/:id/history` | Administrador | Historial de un equipo | 100 (100) |
| `GET /loan-requests` | Administrador | Solicitudes por estado, de la más antigua a la más reciente. Por defecto `PENDIENTE` | 100 (50) |
| `GET /loan-requests/my` | Docente | Sus solicitudes, de la más reciente a la más antigua. Filtro opcional `?status=` | 100 (50) |
| `GET /loan-requests/:id` | Autenticado | Detalle. Un docente solo ve las suyas | — |
| `POST /loan-requests` | Docente | Crea una solicitud | — |
| `PATCH /loan-requests/:id/cancel` | Docente | Cancela una solicitud propia pendiente | — |
| `POST /loan-requests/:id/approve` | Administrador | Aprueba y crea el préstamo | — |
| `POST /loan-requests/:id/reject` | Administrador | Rechaza con motivo | — |
| `GET /loans` | Administrador | Préstamos `?status=ACTIVO\|FINALIZADO` (por defecto `ACTIVO`), el que vence antes primero | 100 (50) |
| `GET /loans/:id` | Autenticado | Detalle. Un docente solo ve los suyos | — |
| `POST /loans/:id/return` | Administrador | Registra la devolución | — |
| `GET /loans/:id/pdf` | Administrador | Comprobante en PDF | — |
| `GET /history` | Administrador | Historial global. Filtros: `eventType`, `startDate`, `endDate`, `equipmentId`, `userId` | 100 (100) |
| `GET /users` | Administrador | Lista los usuarios, sin datos sensibles | — |
| `POST /users` | Administrador | Registra una cuenta y devuelve su contraseña temporal | — |

## Reglas del negocio

**Equipos**

- Nombre hasta 100 caracteres, número de serie hasta 50 y descripción hasta 500. Los tres son
  obligatorios.
- El número de serie no se puede repetir en todo el inventario.
- Un equipo nuevo siempre empieza `DISPONIBLE`.
- Retirar un equipo no lo borra: deja de aparecer, pero su historial se conserva. Un equipo
  prestado no se puede retirar.

**Categorías**

- Nombre único, hasta 50 caracteres.
- Solo se elimina si ningún equipo la usa, **incluidos los retirados**, porque su historial
  sigue mostrándola.

**Solicitudes**

- Propósito obligatorio, hasta 500 caracteres.
- La fecha de inicio no puede ser anterior a hoy, y la de devolución debe ser posterior a la de
  inicio.
- No se acepta si el equipo tiene un préstamo activo que se cruza con **cualquier** día del
  período pedido.
- Al aprobar una, se cancelan automáticamente las demás solicitudes pendientes del mismo equipo
  cuyas fechas se cruzan con las aprobadas.

**Préstamos**

- Un préstamo está **vencido** cuando sigue activo y su fecha de devolución ya pasó.
- La devolución guarda el instante exacto. El retraso se cuenta en días completos: devolver el
  mismo día pactado no es retraso.

**Fechas**

- Los días de préstamo se guardan como días calendario a la medianoche UTC, y "hoy" también se
  calcula en UTC. En Colombia (UTC−5), a partir de las 7 p. m. ya es el día siguiente para la
  API.

**Cuentas**

- Las crea un administrador, con rol docente o administrador. El email no se puede repetir.
- La contraseña temporal tiene 12 caracteres y evita los que se confunden al dictarla (`0/O`,
  `1/l/I`).
- La contraseña que elige el usuario debe tener entre 8 y 72 caracteres y ser distinta de la
  actual.

## Pruebas

```bash
pnpm test
```

Corre las pruebas unitarias y de propiedad de la API (Vitest y fast-check), con la base de
datos simulada. No necesita PostgreSQL.

La **suite de integración** prueba contra un PostgreSQL real. Usa una base desechable en Docker:

```bash
docker compose -f apps/api/docker-compose.test.yml up -d

TEST_DATABASE_URL=postgresql://test:test@localhost:54329/equipment_loan_test \
  pnpm --filter @equipment-loan/api test:integration

docker compose -f apps/api/docker-compose.test.yml down
```

> Nunca apuntes `TEST_DATABASE_URL` a una base con datos reales: la suite le aplica las
> migraciones y escribe en ella.

## Estructura del proyecto

```
equipment-loan-management/
├── apps/
│   ├── api/                      API REST (Express + Prisma)
│   │   ├── prisma/               esquema, migraciones y seed
│   │   ├── src/
│   │   │   ├── config/           variables de entorno y cliente de Prisma
│   │   │   ├── middlewares/      autenticación, roles, contraseña temporal, errores
│   │   │   ├── modules/          un módulo por recurso: router + service + schema
│   │   │   │   ├── auth/  categories/  equipment/  history/
│   │   │   │   └── loan-requests/  loans/  pdf/  users/
│   │   │   └── shared/           errores, fechas, historial, contraseñas
│   │   └── test/                 unitarias, de propiedad e integración
│   └── web/                      interfaz (Next.js)
│       ├── app/
│       │   ├── (auth)/           login
│       │   ├── (admin)/          pantallas del administrador
│       │   ├── (docente)/        pantallas del docente
│       │   ├── change-password/  cambio de contraseña
│       │   └── denied/           acceso denegado
│       ├── components/
│       │   ├── ui/               piezas base: botón, tabla, diálogo…
│       │   └── domain/           piezas del negocio: formularios, diálogos, menús
│       ├── lib/                  cliente HTTP, sesión, tipos de la API, formatos
│       └── middleware.ts         envía a cada rol a su área
└── packages/shared/              enums y tipos compartidos
```

Cada módulo de la API sigue el mismo reparto:

- **`*.schema.ts`** valida la entrada con Zod.
- **`*.service.ts`** aplica las reglas del negocio y habla con la base de datos.
- **`*.router.ts`** define las rutas y los roles que las pueden usar.

Los grupos `(admin)` y `(docente)` no aparecen en la URL: `/inventory` vive en
`app/(admin)/inventory`. Solo sirven para dar a cada rol su propio layout.

## Decisiones técnicas

- **El token de acceso vive en memoria**, nunca en `localStorage`, para que un script
  inyectado no pueda leerlo. Al recargar la página, la sesión se recupera con la cookie de
  refresco.
- **Los roles se comprueban dos veces.** El middleware de Next redirige según el rol, solo por
  comodidad. La autorización real la hace la API en cada petición, con el token de acceso.
- **El historial solo se escribe desde `HistoryService`**, dentro de la misma transacción que
  la operación que lo origina. Si la operación falla, tampoco queda el evento.
- **El PDF se genera fuera de la transacción.** Si falla, no deshace el préstamo: por eso la
  aprobación puede responder `207`.
- **Las contraseñas se guardan solo como hash bcrypt.** La temporal no se guarda en texto
  claro en ningún momento.

## Limitaciones conocidas

- **CORS está fijo en `http://localhost:3000`** (`apps/api/src/app.ts`). Para desplegar, hay
  que cambiar ese origen por el dominio real.
- **La cookie de sesión es `SameSite=Strict`.** En producción, la web y la API deben compartir
  sitio, por ejemplo sirviendo la API bajo el mismo dominio o detrás de un proxy.
- **El historial no registra** la creación de cuentas ni los cambios de categorías; solo
  equipos, solicitudes y préstamos.
- **ESLint no está configurado en `apps/web`.** `pnpm lint` falla ahí porque `next lint` abre
  su asistente. Faltan `eslint`, `eslint-config-next` y un `.eslintrc.json`.
- **No hay pruebas de interfaz.** Las de `apps/web` y `packages/shared` pasan porque están
  vacías.
- **`.env.example` no se versiona**, porque `.gitignore` ignora todo lo que empieza por `.env`.
  Para incluirlo, añade la excepción `!.env.example`.
