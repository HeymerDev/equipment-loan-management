// GET /users — the user list the web app uses to name history authors.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { resetPrismaMock, type PrismaMock } from '../helpers/prisma-mock.js';
import { ADMIN, TEACHER, bearer } from '../helpers/auth.js';

const db = prisma as unknown as PrismaMock;

beforeEach(() => {
  resetPrismaMock(db);
});

describe('GET /users', () => {
  it('lists users alphabetically, selecting only public fields', async () => {
    const users = [
      { id: ADMIN.id, email: ADMIN.email, fullName: 'Ana Admin', role: 'ADMINISTRADOR' },
      { id: TEACHER.id, email: TEACHER.email, fullName: 'Beto Docente', role: 'DOCENTE' },
    ];
    db.user.findMany.mockResolvedValue(users);

    const res = await request(app).get('/api/v1/users').set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: users });
    // The password hash is never read, let alone returned.
    expect(db.user.findMany).toHaveBeenCalledWith({
      select: { id: true, email: true, fullName: true, role: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  });

  it('is reserved to administrators', async () => {
    const res = await request(app).get('/api/v1/users').set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /users', () => {
  const created = {
    id: 'd0000000-0000-4000-8000-0000000000ff',
    email: 'nueva.docente@school.com',
    fullName: 'Nueva Docente',
    role: 'DOCENTE',
  };

  it('registra la cuenta con una contraseña temporal que solo se devuelve una vez', async () => {
    db.user.create.mockResolvedValue(created);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', bearer(ADMIN))
      .send({ fullName: 'Nueva Docente', email: 'Nueva.Docente@school.com', role: 'DOCENTE' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toEqual(created);

    const temporaryPassword = res.body.data.temporaryPassword as string;
    expect(temporaryPassword).toHaveLength(12);

    const data = db.user.create.mock.calls[0]?.[0]?.data as {
      email: string;
      passwordHash: string;
      mustChangePassword: boolean;
    };
    // El email se normaliza y la contraseña se guarda solo como hash.
    expect(data.email).toBe('nueva.docente@school.com');
    expect(data.mustChangePassword).toBe(true);
    expect(data.passwordHash).not.toBe(temporaryPassword);
    expect(bcrypt.compareSync(temporaryPassword, data.passwordHash)).toBe(true);
  });

  it('traduce el email repetido a un 409', async () => {
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', bearer(ADMIN))
      .send({ fullName: 'Nueva Docente', email: 'docente@school.com', role: 'DOCENTE' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rechaza un rol que no existe', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', bearer(ADMIN))
      .send({ fullName: 'Nueva Docente', email: 'nueva@school.com', role: 'RECTOR' });

    expect(res.status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('es exclusivo de los administradores', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', bearer(TEACHER))
      .send({ fullName: 'Nueva Docente', email: 'nueva@school.com', role: 'DOCENTE' });

    expect(res.status).toBe(403);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});
