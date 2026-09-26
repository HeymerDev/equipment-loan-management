// Categorías de equipos: catálogo que el administrador mantiene.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
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

const ID = 'c0000000-0000-4000-8000-000000000001';

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });

beforeEach(() => {
  resetPrismaMock(db);
});

describe('GET /categories', () => {
  it('devuelve las categorías con sus equipos activos', async () => {
    db.category.findMany.mockResolvedValue([
      { id: ID, name: 'Audio', _count: { equipment: 3 } },
    ]);

    const res = await request(app).get('/api/v1/categories').set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: ID, name: 'Audio', equipmentCount: 3 }] });
  });
});

describe('POST /categories', () => {
  it('crea la categoría con el nombre sin espacios sobrantes', async () => {
    db.category.create.mockResolvedValue({ id: ID, name: 'Proyección' });

    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', bearer(ADMIN))
      .send({ name: '  Proyección  ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { id: ID, name: 'Proyección', equipmentCount: 0 } });
    expect(db.category.create).toHaveBeenCalledWith({
      data: { name: 'Proyección' },
      select: { id: true, name: true },
    });
  });

  it('traduce el nombre repetido a un 409', async () => {
    db.category.create.mockRejectedValue(duplicate());

    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', bearer(ADMIN))
      .send({ name: 'Audio' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rechaza un nombre vacío', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', bearer(ADMIN))
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(db.category.create).not.toHaveBeenCalled();
  });

  it('es exclusivo de los administradores', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', bearer(TEACHER))
      .send({ name: 'Audio' });

    expect(res.status).toBe(403);
    expect(db.category.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /categories/:id', () => {
  it('renombra sin tocar los equipos', async () => {
    db.category.findUnique.mockResolvedValue({ id: ID });
    db.category.update.mockResolvedValue({
      id: ID,
      name: 'Audio y sonido',
      _count: { equipment: 2 },
    });

    const res = await request(app)
      .patch(`/api/v1/categories/${ID}`)
      .set('Authorization', bearer(ADMIN))
      .send({ name: 'Audio y sonido' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: ID, name: 'Audio y sonido', equipmentCount: 2 });
    expect(db.equipment.updateMany).not.toHaveBeenCalled();
  });

  it('responde 404 si la categoría no existe', async () => {
    db.category.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/categories/${ID}`)
      .set('Authorization', bearer(ADMIN))
      .send({ name: 'Audio' });

    expect(res.status).toBe(404);
    expect(db.category.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /categories/:id', () => {
  it('elimina una categoría que nadie usa', async () => {
    db.category.findUnique.mockResolvedValue({ id: ID });
    db.equipment.count.mockResolvedValue(0);

    const res = await request(app)
      .delete(`/api/v1/categories/${ID}`)
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(204);
    expect(db.category.delete).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('se niega cuando todavía hay equipos, incluidos los retirados', async () => {
    db.category.findUnique.mockResolvedValue({ id: ID });
    db.equipment.count.mockResolvedValue(4);

    const res = await request(app)
      .delete(`/api/v1/categories/${ID}`)
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('4 equipos');
    // El recuento no filtra por deletedAt: un equipo retirado también cuenta.
    expect(db.equipment.count).toHaveBeenCalledWith({ where: { categoryId: ID } });
    expect(db.category.delete).not.toHaveBeenCalled();
  });
});
