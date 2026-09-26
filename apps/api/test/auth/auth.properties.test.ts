// Task 2.4 — property tests for authentication and RBAC (Properties 27–30),
// exercised over HTTP against the real Express app with Prisma mocked.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { authRouter } from '../../src/modules/auth/auth.router.js';
import { categoriesRouter } from '../../src/modules/categories/categories.router.js';
import { equipmentRouter } from '../../src/modules/equipment/equipment.router.js';
import { loanRequestsRouter } from '../../src/modules/loan-requests/loan-requests.router.js';
import { loansRouter } from '../../src/modules/loans/loans.router.js';
import { historyRouter } from '../../src/modules/history/history.router.js';
import { usersRouter } from '../../src/modules/users/users.router.js';
import { bindTable, resetPrismaMock, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { totalCallCount } from '../helpers/assertions.js';
import {
  ROLES,
  TEST_JWT_SECRET,
  TEST_REFRESH_SECRET,
  asciiArb,
  emailArb,
  type RoleName,
} from '../helpers/auth.js';

const db = prisma as unknown as PrismaMock;

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Endpoint {
  method: Method;
  path: string;
  /** Roles allowed through; `'any'` means any authenticated user. */
  roles: RoleName[] | 'any';
}

const ID = '7d5e0f1a-2b3c-4d5e-8f60-718293a4b5c6';

/** Every route that requires authentication, with the roles it admits. */
const PROTECTED: Endpoint[] = [
  { method: 'post', path: '/api/v1/auth/logout', roles: 'any' },
  { method: 'post', path: '/api/v1/auth/change-password', roles: 'any' },
  { method: 'get', path: '/api/v1/categories', roles: 'any' },
  { method: 'post', path: '/api/v1/categories', roles: ['ADMINISTRADOR'] },
  { method: 'patch', path: `/api/v1/categories/${ID}`, roles: ['ADMINISTRADOR'] },
  { method: 'delete', path: `/api/v1/categories/${ID}`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: '/api/v1/equipment', roles: 'any' },
  { method: 'post', path: '/api/v1/equipment', roles: ['ADMINISTRADOR'] },
  { method: 'get', path: `/api/v1/equipment/${ID}`, roles: 'any' },
  { method: 'patch', path: `/api/v1/equipment/${ID}`, roles: ['ADMINISTRADOR'] },
  { method: 'delete', path: `/api/v1/equipment/${ID}`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: `/api/v1/equipment/${ID}/history`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: '/api/v1/loan-requests', roles: ['ADMINISTRADOR'] },
  { method: 'post', path: '/api/v1/loan-requests', roles: ['DOCENTE'] },
  { method: 'get', path: '/api/v1/loan-requests/my', roles: ['DOCENTE'] },
  { method: 'get', path: `/api/v1/loan-requests/${ID}`, roles: 'any' },
  { method: 'patch', path: `/api/v1/loan-requests/${ID}/cancel`, roles: ['DOCENTE'] },
  { method: 'post', path: `/api/v1/loan-requests/${ID}/approve`, roles: ['ADMINISTRADOR'] },
  { method: 'post', path: `/api/v1/loan-requests/${ID}/reject`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: '/api/v1/loans', roles: ['ADMINISTRADOR'] },
  { method: 'get', path: `/api/v1/loans/${ID}`, roles: 'any' },
  { method: 'post', path: `/api/v1/loans/${ID}/return`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: `/api/v1/loans/${ID}/pdf`, roles: ['ADMINISTRADOR'] },
  { method: 'get', path: '/api/v1/history', roles: ['ADMINISTRADOR'] },
  { method: 'get', path: '/api/v1/users', roles: ['ADMINISTRADOR'] },
  { method: 'post', path: '/api/v1/users', roles: ['ADMINISTRADOR'] },
];

const PUBLIC_ROUTES = new Set(['POST /api/v1/auth/login', 'POST /api/v1/auth/refresh']);

const MOUNTS: Array<[string, unknown]> = [
  ['/api/v1/auth', authRouter],
  ['/api/v1/categories', categoriesRouter],
  ['/api/v1/equipment', equipmentRouter],
  ['/api/v1/loan-requests', loanRequestsRouter],
  ['/api/v1/loans', loansRouter],
  ['/api/v1/history', historyRouter],
  ['/api/v1/users', usersRouter],
];

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Routes actually declared on the routers, as "METHOD /full/path/:id". */
function declaredRoutes(): string[] {
  return MOUNTS.flatMap(([prefix, router]) =>
    ((router as { stack: RouteLayer[] }).stack)
      .filter((layer) => layer.route !== undefined)
      .flatMap((layer) =>
        Object.keys(layer.route!.methods).map(
          (method) =>
            `${method.toUpperCase()} ${prefix}${layer.route!.path === '/' ? '' : layer.route!.path}`,
        ),
      ),
  );
}

const endpointKey = (endpoint: Endpoint): string =>
  `${endpoint.method.toUpperCase()} ${endpoint.path.replace(ID, ':id')}`;

let server: Server;

beforeAll(() => {
  server = app.listen(0);
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetPrismaMock(db);
});

function send(endpoint: Endpoint, authorization?: string) {
  let req = request(server)[endpoint.method](endpoint.path);
  if (authorization !== undefined) req = req.set('Authorization', authorization);
  if (endpoint.method === 'post' || endpoint.method === 'patch') req = req.send({});
  return req;
}

const claimsArb = fc.record({
  sub: fc.uuid(),
  email: emailArb,
  role: fc.constantFrom<string>(...ROLES),
});

/** Anything that is not a valid access token for this API. */
const invalidAuthorizationArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  asciiArb({ maxLength: 60 }),
  asciiArb({ maxLength: 60 }).map((value) => `Bearer ${value}`),
  claimsArb.map((claims) => `Bearer ${jwt.sign(claims, 'an-attacker-secret-0123456789')}`),
  claimsArb.map(
    (claims) =>
      `Bearer ${jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, TEST_JWT_SECRET)}`,
  ),
  // A refresh token is not an access token.
  claimsArb.map((claims) => `Bearer ${jwt.sign({ sub: claims.sub }, TEST_REFRESH_SECRET)}`),
  // Right token, wrong scheme.
  fc
    .tuple(fc.constantFrom('Basic', 'Token', 'bearer', 'JWT'), claimsArb)
    .map(([scheme, claims]) => `${scheme} ${jwt.sign(claims, TEST_JWT_SECRET)}`),
);

describe('route inventory', () => {
  it('covers every non-public route declared on the routers', () => {
    const covered = new Set(PROTECTED.map(endpointKey));
    const uncovered = declaredRoutes().filter(
      (route) => !PUBLIC_ROUTES.has(route) && !covered.has(route),
    );
    expect(uncovered).toEqual([]);
  });
});

describe('authentication and RBAC properties', () => {
  it('Feature: equipment-loan-management, Property 27: Protección universal de rutas (autenticación)', async () => {
    for (const endpoint of PROTECTED) {
      await fc.assert(
        fc.asyncProperty(invalidAuthorizationArb, async (authorization) => {
          resetPrismaMock(db);

          const res = await send(endpoint, authorization);

          expect(res.status, `${endpointKey(endpoint)} with ${String(authorization)}`).toBe(401);
          expect(res.body.error?.code).toBe('UNAUTHORIZED');
          expect(res.body.data).toBeUndefined();
          expect(totalCallCount(db)).toBe(0);
        }),
        { numRuns: 100 },
      );
    }
  });

  it('Feature: equipment-loan-management, Property 28: Aplicación universal de RBAC', async () => {
    const restricted = PROTECTED.filter(
      (endpoint): endpoint is Endpoint & { roles: RoleName[] } => endpoint.roles !== 'any',
    );

    for (const endpoint of restricted) {
      const deniedRoleArb = fc.oneof(
        // The other defined role(s)…
        fc.constantFrom<string>(...ROLES.filter((role) => !endpoint.roles.includes(role))),
        // …and roles that do not exist at all.
        fc
          .stringMatching(/^[A-Z_]{1,20}$/)
          .filter((role) => !(endpoint.roles as string[]).includes(role)),
      );

      await fc.assert(
        fc.asyncProperty(claimsArb, deniedRoleArb, async (claims, role) => {
          resetPrismaMock(db);
          const token = jwt.sign({ ...claims, role }, TEST_JWT_SECRET, { expiresIn: '15m' });

          const res = await send(endpoint, `Bearer ${token}`);

          expect(res.status, `${endpointKey(endpoint)} as ${role}`).toBe(403);
          expect(res.body.error?.code).toBe('FORBIDDEN');
          expect(res.body.data).toBeUndefined();
          // No data access and no side effect of any kind.
          expect(totalCallCount(db)).toBe(0);
        }),
        { numRuns: 100 },
      );
    }
  });

  it('Feature: equipment-loan-management, Property 29: Invalidación de sesión al cerrar sesión', async () => {
    const accountArb = fc.record({
      email: emailArb,
      password: asciiArb({ minLength: 1, maxLength: 30 }),
      role: fc.constantFrom<string>(...ROLES),
    });

    await fc.assert(
      fc.asyncProperty(accountArb, async ({ email, password, role }) => {
        resetPrismaMock(db);

        const users: Row[] = [
          {
            id: randomUUID(),
            email,
            passwordHash: bcrypt.hashSync(password, 4),
            fullName: 'Usuario de Prueba',
            role,
            createdAt: new Date(),
          },
        ];
        const sessions: Row[] = [];
        bindTable(db.user, users);
        bindTable(db.refreshToken, sessions);
        db.refreshToken.create.mockImplementation(async ({ data }: { data: Row }) => {
          const row: Row = {
            id: randomUUID(),
            revokedAt: null,
            createdAt: new Date(),
            ...data,
            user: users.find((candidate) => candidate.id === data['userId']),
          };
          sessions.push(row);
          return row;
        });

        const login = await request(server).post('/api/v1/auth/login').send({ email, password });
        expect(login.status).toBe(200);

        const setCookie = login.get('Set-Cookie') as unknown as string[];
        const cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
        const accessToken = login.body.data.accessToken as string;

        // The session works before logging out…
        const beforeLogout = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie);
        expect(beforeLogout.status).toBe(200);

        const logout = await request(server)
          .post('/api/v1/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Cookie', cookie);
        expect(logout.status).toBe(204);

        // …and is dead afterwards.
        const afterLogout = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie);
        expect(afterLogout.status).toBe(401);
        expect(afterLogout.body.data).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 30: Mensaje genérico en credenciales incorrectas', async () => {
    const passwordArb = asciiArb({ minLength: 1, maxLength: 30 });

    await fc.assert(
      fc.asyncProperty(
        emailArb,
        passwordArb,
        emailArb,
        passwordArb,
        async (email, password, wrongEmail, wrongPassword) => {
          fc.pre(wrongEmail !== email && wrongPassword !== password);
          resetPrismaMock(db);
          bindTable(db.user, [
            {
              id: randomUUID(),
              email,
              passwordHash: bcrypt.hashSync(password, 4),
              fullName: 'Usuario de Prueba',
              role: 'DOCENTE',
              createdAt: new Date(),
            },
          ]);

          const attempts = [
            { email: wrongEmail, password }, // wrong email
            { email, password: wrongPassword }, // wrong password
            { email: wrongEmail, password: wrongPassword }, // both wrong
          ];
          const responses = await Promise.all(
            attempts.map((body) => request(server).post('/api/v1/auth/login').send(body)),
          );
          const observed = responses.map((res) => ({
            status: res.status,
            body: res.body as unknown,
            setsCookie: res.get('Set-Cookie') !== undefined,
          }));

          expect(observed[0]).toEqual({
            status: 401,
            body: { error: { code: 'UNAUTHORIZED', message: 'Credenciales incorrectas' } },
            setsCookie: false,
          });
          expect(observed[1]).toEqual(observed[0]);
          expect(observed[2]).toEqual(observed[0]);
          expect(db.refreshToken.create).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
