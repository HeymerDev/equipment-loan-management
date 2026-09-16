import jwt from 'jsonwebtoken';
import fc from 'fast-check';

// Must match `test.env` in vitest.config.mts.
export const TEST_JWT_SECRET = 'unit-test-jwt-secret-0123456789';
export const TEST_REFRESH_SECRET = 'unit-test-refresh-secret-0123456789';

export type RoleName = 'ADMINISTRADOR' | 'DOCENTE';
export const ROLES: RoleName[] = ['ADMINISTRADOR', 'DOCENTE'];

export interface TestUser {
  id: string;
  email: string;
  role: string;
}

export const ADMIN: TestUser = {
  id: 'a0000000-0000-4000-8000-000000000001',
  email: 'admin@test.local',
  role: 'ADMINISTRADOR',
};

export const TEACHER: TestUser = {
  id: 'd0000000-0000-4000-8000-000000000002',
  email: 'docente@test.local',
  role: 'DOCENTE',
};

export const OTHER_TEACHER: TestUser = {
  id: 'd0000000-0000-4000-8000-000000000003',
  email: 'otro.docente@test.local',
  role: 'DOCENTE',
};

export function signAccessToken(user: TestUser, secret = TEST_JWT_SECRET): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret, {
    expiresIn: '15m',
  });
}

export const bearer = (user: TestUser): string => `Bearer ${signAccessToken(user)}`;

/** Plain addresses that the login schema's email check always accepts. */
export const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/),
    fc.constantFrom('test.local', 'colegio.edu', 'example.org'),
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** Printable ASCII, safe to put in an HTTP header or a JSON body. */
export const asciiArb = (constraints: { minLength?: number; maxLength?: number } = {}) =>
  fc.string({ unit: 'grapheme-ascii', ...constraints });
