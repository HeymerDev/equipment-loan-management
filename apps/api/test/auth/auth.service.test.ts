// Task 2.5 — unit tests for AuthService.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/config/prisma.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { UnauthorizedError } from '../../src/shared/errors.js';
import { resetPrismaMock, type PrismaMock } from '../helpers/prisma-mock.js';
import { TEST_JWT_SECRET, TEST_REFRESH_SECRET } from '../helpers/auth.js';

const db = prisma as unknown as PrismaMock;
const service = new AuthService();

const PASSWORD = 'correct-horse-battery';
const user = {
  id: 'd0000000-0000-4000-8000-00000000000a',
  email: 'docente@test.local',
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
  fullName: 'Docente de Prueba',
  role: 'DOCENTE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function signRefresh(sub = user.id, options: jwt.SignOptions = { expiresIn: '7d' }): string {
  return jwt.sign({ sub }, TEST_REFRESH_SECRET, options);
}

function storedToken(token: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'r0000000-0000-4000-8000-000000000001',
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    revokedAt: null,
    createdAt: new Date(),
    user,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock(db);
});

describe('AuthService.login', () => {
  it('issues a 15-minute access token and a 7-day refresh token for valid credentials', async () => {
    db.user.findUnique.mockResolvedValue(user);
    db.refreshToken.create.mockResolvedValue({});

    const { accessToken, refreshToken } = await service.login(user.email, PASSWORD);

    const access = jwt.verify(accessToken, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(access).toMatchObject({ sub: user.id, email: user.email, role: user.role });
    expect(access.exp! - access.iat!).toBe(15 * 60);

    const refresh = jwt.verify(refreshToken, TEST_REFRESH_SECRET) as jwt.JwtPayload;
    expect(refresh.sub).toBe(user.id);
    expect(refresh.exp! - refresh.iat!).toBe(7 * 24 * 60 * 60);
  });

  it('persists the session with a 7-day expiry', async () => {
    db.user.findUnique.mockResolvedValue(user);
    db.refreshToken.create.mockResolvedValue({});

    const before = Date.now();
    await service.login(user.email, PASSWORD);
    const after = Date.now();

    expect(db.refreshToken.create).toHaveBeenCalledTimes(1);
    const { data } = db.refreshToken.create.mock.calls[0]![0];
    expect(data.userId).toBe(user.id);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(after + SEVEN_DAYS_MS);
  });

  it('keeps the access and refresh secrets separate', async () => {
    db.user.findUnique.mockResolvedValue(user);
    db.refreshToken.create.mockResolvedValue({});

    const { accessToken, refreshToken } = await service.login(user.email, PASSWORD);

    expect(() => jwt.verify(accessToken, TEST_REFRESH_SECRET)).toThrow();
    expect(() => jwt.verify(refreshToken, TEST_JWT_SECRET)).toThrow();
  });

  it('rejects an unknown email with the generic message and persists nothing', async () => {
    db.user.findUnique.mockResolvedValue(null);

    const error = await service.login('nadie@test.local', PASSWORD).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect((error as UnauthorizedError).message).toBe('Credenciales incorrectas');
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with exactly the same message', async () => {
    db.user.findUnique.mockResolvedValue(user);

    const error = await service.login(user.email, 'wrong-password').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect((error as UnauthorizedError).message).toBe('Credenciales incorrectas');
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('issues a new access token for a valid, stored, unrevoked refresh token', async () => {
    const token = signRefresh();
    db.refreshToken.findUnique.mockResolvedValue(storedToken(token));

    const { accessToken } = await service.refresh(token);

    const payload = jwt.verify(accessToken, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(payload).toMatchObject({ sub: user.id, email: user.email, role: user.role });
  });

  it('rejects a revoked refresh token', async () => {
    const token = signRefresh();
    db.refreshToken.findUnique.mockResolvedValue(storedToken(token, { revokedAt: new Date() }));

    await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a refresh token whose stored session has expired', async () => {
    const token = signRefresh();
    db.refreshToken.findUnique.mockResolvedValue(
      storedToken(token, { expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a well-signed token that was never stored', async () => {
    db.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refresh(signRefresh())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token signed with another secret without querying the database', async () => {
    const forged = jwt.sign({ sub: user.id }, 'some-other-secret-0123456789', { expiresIn: '7d' });

    await expect(service.refresh(forged)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT', async () => {
    const expired = jwt.sign(
      { sub: user.id, exp: Math.floor(Date.now() / 1000) - 60 },
      TEST_REFRESH_SECRET,
    );

    await expect(service.refresh(expired)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a stored token that belongs to a different user than its subject', async () => {
    const token = signRefresh('d0000000-0000-4000-8000-0000000000ff');
    db.refreshToken.findUnique.mockResolvedValue(storedToken(token));

    await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('AuthService.logout', () => {
  it('revokes the refresh token', async () => {
    const token = signRefresh();
    db.refreshToken.update.mockResolvedValue({});

    const before = Date.now();
    await service.logout(token);

    expect(db.refreshToken.update).toHaveBeenCalledTimes(1);
    const { where, data } = db.refreshToken.update.mock.calls[0]![0];
    expect(where).toEqual({ token });
    expect(data.revokedAt).toBeInstanceOf(Date);
    expect(data.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('is idempotent: an unknown token does not throw', async () => {
    db.refreshToken.update.mockRejectedValue(new Error('Record to update not found'));

    await expect(service.logout('unknown-token')).resolves.toBeUndefined();
  });
});
