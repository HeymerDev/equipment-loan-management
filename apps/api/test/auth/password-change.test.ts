// Cambio de contraseña: el usuario reemplaza la que le entregó el administrador.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import {
  UnauthorizedError,
  ValidationError,
} from '../../src/shared/errors.js';
import { resetPrismaMock, type PrismaMock } from '../helpers/prisma-mock.js';
import { TEACHER, TEST_JWT_SECRET, bearer } from '../helpers/auth.js';

const db = prisma as unknown as PrismaMock;
const service = new AuthService();

const CURRENT = 'temporal-de-la-admin';
const user = {
  id: TEACHER.id,
  email: TEACHER.email,
  passwordHash: bcrypt.hashSync(CURRENT, 4),
  fullName: 'Docente de Prueba',
  role: 'DOCENTE',
  mustChangePassword: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

/** Un token de acceso que todavía arrastra la contraseña temporal. */
function pendingToken(): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: true,
    },
    TEST_JWT_SECRET,
    { expiresIn: '15m' },
  );
}

beforeEach(() => {
  resetPrismaMock(db);
});

describe('AuthService.changePassword', () => {
  it('guarda el hash de la nueva contraseña y limpia la marca', async () => {
    db.user.findUnique.mockResolvedValue(user);

    await service.changePassword(user.id, CURRENT, 'una-contraseña-nueva');

    const data = db.user.update.mock.calls[0]?.[0]?.data as {
      passwordHash: string;
      mustChangePassword: boolean;
    };
    expect(data.mustChangePassword).toBe(false);
    // Se guarda el hash, nunca el texto plano.
    expect(data.passwordHash).not.toBe('una-contraseña-nueva');
    expect(bcrypt.compareSync('una-contraseña-nueva', data.passwordHash)).toBe(true);
  });

  it('revoca las demás sesiones y conserva la actual', async () => {
    db.user.findUnique.mockResolvedValue(user);

    await service.changePassword(user.id, CURRENT, 'otra-contraseña-mas', 'cookie-actual');

    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null, token: { not: 'cookie-actual' } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rechaza una contraseña actual incorrecta y no escribe nada', async () => {
    db.user.findUnique.mockResolvedValue(user);

    await expect(
      service.changePassword(user.id, 'no-es-la-mia', 'una-contraseña-nueva'),
    ).rejects.toMatchObject({ statusCode: 400, field: 'currentPassword' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rechaza repetir la contraseña actual', async () => {
    db.user.findUnique.mockResolvedValue(user);

    await expect(service.changePassword(user.id, CURRENT, CURRENT)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rechaza un usuario que ya no existe', async () => {
    db.user.findUnique.mockResolvedValue(null);

    await expect(
      service.changePassword(user.id, CURRENT, 'una-contraseña-nueva'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('POST /auth/change-password', () => {
  it('responde 204 y acepta el cambio aunque la contraseña sea temporal', async () => {
    db.user.findUnique.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${pendingToken()}`)
      .send({ currentPassword: CURRENT, newPassword: 'una-contraseña-nueva' });

    expect(res.status).toBe(204);
    expect(db.user.update).toHaveBeenCalled();
  });

  it('exige al menos 8 caracteres', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(TEACHER))
      .send({ currentPassword: CURRENT, newPassword: 'corta' });

    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('requiere sesión', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: CURRENT, newPassword: 'una-contraseña-nueva' });

    expect(res.status).toBe(401);
  });
});

describe('bloqueo mientras la contraseña sea temporal', () => {
  it('cierra el resto de la API con 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const res = await request(app)
      .get('/api/v1/equipment')
      .set('Authorization', `Bearer ${pendingToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(db.equipment.findMany).not.toHaveBeenCalled();
  });

  it('deja pasar a quien ya tiene su propia contraseña', async () => {
    db.equipment.findMany.mockResolvedValue([]);
    db.equipment.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/equipment')
      .set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(200);
  });
});
