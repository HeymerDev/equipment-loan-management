# Préstamo de equipos tecnológicos

Sistema para que los docentes de una institución educativa soliciten en préstamo equipos
tecnológicos y el administrador los apruebe, entregue y reciba de vuelta, con comprobante
en PDF e historial de todo lo que ocurre.

## Cómo funciona

- El **docente** consulta el catálogo de equipos disponibles y crea una solicitud indicando
  el propósito y el período. Puede cancelarla mientras siga pendiente.
- El **administrador** revisa la cola de solicitudes pendientes y las aprueba o rechaza.
  Al aprobar, el equipo pasa a prestado, se crea el préstamo y se genera su comprobante PDF.
  Las demás solicitudes pendientes de ese equipo que se cruzaban con esas fechas se cancelan solas.
- Al registrar la devolución, el equipo vuelve a estar disponible y queda constancia de si
  se entregó tarde.
- Cada una de esas acciones deja un evento en el **historial**, que es de solo lectura.

## Stack

| Parte | Tecnología |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API | Express 4, TypeScript, Zod, Prisma sobre PostgreSQL |
| Autenticación | JWT: token de acceso de 15 min en memoria, refresh de 7 días en cookie `HttpOnly` |
| PDF | PDFKit |
| Web | Next.js 14 (App Router), Tailwind, componentes propios sobre Radix |
| Pruebas | Vitest y fast-check para las propiedades |

## Estructura

```
apps/
  api/            API REST en /api/v1
    prisma/       esquema, migraciones y seed
    src/modules/  auth, categories, equipment, loan-requests, loans, history, users, pdf
    test/         unitarias, de propiedad e integración contra PostgreSQL
  web/
    app/(auth)/     login
    app/(admin)/    dashboard, inventory, requests, loans, history
    app/(docente)/  equipment, my-requests
    components/     ui/ (base) y domain/ (del dominio)
    lib/            cliente HTTP, sesión, formatos, tipos de la API
packages/shared/  enums y tipos compartidos
```

Los grupos `(admin)` y `(docente)` no aparecen en la URL: sirven para dar a cada rol su
propio layout. El middleware decide a dónde puede entrar cada quien y la API vuelve a
comprobarlo en cada petición.

## Puesta en marcha

Necesitas Node 20 o superior, pnpm 9 y una base PostgreSQL.

```bash
pnpm install
```

Copia `.env.example` a `apps/api/.env` y completa los valores. Después:

```bash
pnpm --filter @equipment-loan/api db:migrate
pnpm --filter @equipment-loan/api db:seed
pnpm dev
```

La API queda en `http://localhost:3001` y la web en `http://localhost:3000`.

### Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión de PostgreSQL |
| `JWT_SECRET` | Sí | Firma del token de acceso, mínimo 16 caracteres |
| `JWT_REFRESH_SECRET` | Sí | Firma del refresh token, mínimo 16 caracteres |
| `PORT` | No | Puerto de la API, por defecto 3001 |
| `INSTITUTION_NAME` | No | Nombre que se imprime en el comprobante |
| `APP_TIMEZONE` | No | Zona IANA para la hora del comprobante, p. ej. `America/Bogota` |
| `NEXT_PUBLIC_API_URL` | No | Base de la API que usa la web, por defecto `http://localhost:3001/api/v1` |
| `TEST_DATABASE_URL` | Solo para pruebas | Base desechable de la suite de integración |

`.gitignore` ignora todo lo que empiece por `.env`, incluido `.env.example`. Si quieres
versionar ese archivo de ejemplo, añade una excepción `!.env.example`.

### Usuarios del seed

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@school.com` | `password123` |
| Docente | `docente@school.com` | `password123` |

Son credenciales de desarrollo, escritas en claro en `apps/api/prisma/seed.ts`. No las uses
en un entorno real.

## API

Todas las rutas cuelgan de `/api/v1` y, salvo el login, piden la cabecera
`Authorization: Bearer <token>`.

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/login` | Público | Devuelve el token de acceso y deja el refresh en cookie |
| `POST /auth/refresh` | Cookie | Renueva el token de acceso |
| `POST /auth/logout` | Autenticado | Cierra la sesión y borra la cookie |
| `GET /categories` | Autenticado | Categorías de equipos |
| `GET /equipment` | Autenticado | Inventario paginado, con filtro por estado |
| `POST`, `PATCH`, `DELETE /equipment[/:id]` | Administrador | Registrar, editar y retirar equipos |
| `GET /equipment/:id/history` | Administrador | Historial de un equipo |
| `POST /loan-requests` | Docente | Crear una solicitud |
| `GET /loan-requests/my` | Docente | Sus solicitudes, de la más reciente a la más antigua |
| `PATCH /loan-requests/:id/cancel` | Docente | Cancelar una solicitud pendiente |
| `GET /loan-requests` | Administrador | Cola de pendientes, de la más antigua a la más reciente |
| `POST /loan-requests/:id/approve` | Administrador | Aprobar y crear el préstamo |
| `POST /loan-requests/:id/reject` | Administrador | Rechazar con un motivo de 10 a 500 caracteres |
| `GET /loans` | Administrador | Préstamos activos o finalizados |
| `POST /loans/:id/return` | Administrador | Registrar la devolución |
| `GET /loans/:id/pdf` | Administrador | Comprobante en PDF |
| `GET /history` | Administrador | Historial global, con filtros |
| `GET /users` | Administrador | Usuarios, sin datos sensibles |

La aprobación responde `200` con el comprobante listo, o `207` si el préstamo se creó pero
el PDF falló: en ese caso el préstamo es válido y el comprobante se puede volver a pedir.

## Pruebas

```bash
pnpm test
```

Corre las pruebas unitarias y de propiedad de la API. La suite de integración usa una base
desechable en Docker y se pide aparte:

```bash
docker compose -f apps/api/docker-compose.test.yml up -d
TEST_DATABASE_URL=postgresql://test:test@localhost:54329/equipment_loan_test pnpm --filter @equipment-loan/api test:integration
docker compose -f apps/api/docker-compose.test.yml down
```

Nunca apuntes `TEST_DATABASE_URL` a una base real: la suite le aplica las migraciones.

## Decisiones que conviene conocer

- **El token de acceso vive en memoria**, nunca en `localStorage`. Al recargar la página, la
  sesión se recupera con la cookie de refresco.
- **Las fechas de préstamo son días calendario en UTC**, que es con lo que valida la API. Los
  instantes exactos (creación, devolución real, historial) se muestran en la hora local.
- **Los equipos no se borran**, se retiran. Su historial se conserva y un equipo prestado no
  se puede retirar.
- **El historial solo se escribe desde `HistoryService`**, dentro de la misma transacción que
  la operación que lo origina. El PDF se genera fuera de la transacción, para que un fallo
  suyo nunca deshaga un préstamo.

## Pendiente

- ESLint no está configurado en `apps/web`: `pnpm lint` falla ahí porque `next lint` abre su
  asistente. Faltan `eslint` y `eslint-config-next` y un `.eslintrc.json`.
- No hay pruebas de interfaz; las de `apps/web` y `packages/shared` pasan por estar vacías.
