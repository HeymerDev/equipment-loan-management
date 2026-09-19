// GET /users — the user list the web app uses to name history authors.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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
