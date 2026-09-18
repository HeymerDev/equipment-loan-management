// Task 5.4 — unit tests for EquipmentService and its HTTP contract.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { Prisma } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { equipmentService } from '../../src/modules/equipment/equipment.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock } from '../helpers/prisma-mock.js';
import { ADMIN, TEACHER, bearer } from '../helpers/auth.js';
import { World } from '../helpers/world.js';

const db = prisma as unknown as PrismaMock;
let world: World;

let server: Server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  resetPrismaMock(db);
  world = new World(db);
});

const categoryId = () => world.categories[0]!['id'] as string;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Laptop Lenovo T14',
    serialNumber: 'LNV-T14-0001',
    description: 'Laptop del laboratorio de informática',
    categoryId: categoryId(),
    ...overrides,
  };
}

const post = (body: object) =>
  request(server).post('/api/v1/equipment').set('Authorization', bearer(ADMIN)).send(body);

describe('POST /equipment — field limits (Req 1.1, 1.7)', () => {
  it('accepts every field exactly at its limit (100 / 50 / 500)', async () => {
    const res = await post(
      validBody({ name: 'n'.repeat(100), serialNumber: 's'.repeat(50), description: 'd'.repeat(500) }),
    );

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'DISPONIBLE', categoryName: 'Laptops' });
    expect(world.equipment).toHaveLength(1);
  });

  it.each([
    ['name', 'n'.repeat(101), 'El nombre no puede exceder 100 caracteres'],
    ['serialNumber', 's'.repeat(51), 'El número de serie no puede exceder 50 caracteres'],
    ['description', 'd'.repeat(501), 'La descripción no puede exceder 500 caracteres'],
  ])('rejects %s one character over the limit', async (field, value, message) => {
    const res = await post(validBody({ [field]: value }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field, message });
    expect(writeCallCount(db)).toBe(0);
  });

  it.each(['name', 'serialNumber', 'description', 'categoryId'])(
    'rejects a missing %s and names the field',
    async (field) => {
      const body: Record<string, unknown> = validBody();
      delete body[field];

      const res = await post(body);

      expect(res.status).toBe(400);
      expect(res.body.error.field).toBe(field);
      expect(writeCallCount(db)).toBe(0);
    },
  );

  it('treats a whitespace-only name as empty', async () => {
    const res = await post(validBody({ name: '    ' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ field: 'name', message: 'El nombre es requerido' });
  });

  it('stores trimmed values', async () => {
    const res = await post(validBody({ name: '  Proyector Epson  ' }));

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Proyector Epson');
  });

  it('is reserved to administrators', async () => {
    const res = await request(server)
      .post('/api/v1/equipment')
      .set('Authorization', bearer(TEACHER))
      .send(validBody());

    expect(res.status).toBe(403);
    expect(writeCallCount(db)).toBe(0);
  });
});

describe('EquipmentService.createEquipment', () => {
  it('rejects a duplicate serial number with a clear message and persists nothing (Req 1.6)', async () => {
    world.addEquipment({ serialNumber: 'LNV-T14-0001' });

    const error = await equipmentService.createEquipment(validBody(), ADMIN.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe('El número de serie ya está en uso');
    expect(world.equipment).toHaveLength(1);
    expect(writeCallCount(db)).toBe(0);
  });

  it('answers 409 over HTTP for the duplicate', async () => {
    world.addEquipment({ serialNumber: 'LNV-T14-0001' });

    const res = await post(validBody());

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'CONFLICT', message: 'El número de serie ya está en uso' });
  });

  it('rejects a category that does not exist, naming the field', async () => {
    const error = await equipmentService
      .createEquipment(validBody({ categoryId: 'c0000000-0000-4000-8000-0000000000ff' }), ADMIN.id)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe('categoryId');
    expect(writeCallCount(db)).toBe(0);
  });

  it('creates the equipment and its EQUIPMENT_CREATED entry in one transaction', async () => {
    const created = await equipmentService.createEquipment(validBody(), ADMIN.id);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.tx.equipment.create).toHaveBeenCalledTimes(1);
    expect(db.tx.historyEvent.create).toHaveBeenCalledTimes(1);
    expect(world.events[0]).toMatchObject({
      eventType: 'EQUIPMENT_CREATED',
      entityId: created.id,
      entityTable: 'Equipment',
      userId: ADMIN.id,
      equipmentId: created.id,
    });
  });

  it('maps a unique-index violation raised inside the transaction to a 409', async () => {
    db.tx.equipment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(equipmentService.createEquipment(validBody(), ADMIN.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('lets any other database error through untouched', async () => {
    const failure = new Error('connection reset');
    db.tx.equipment.create.mockRejectedValue(failure);

    await expect(equipmentService.createEquipment(validBody(), ADMIN.id)).rejects.toBe(failure);
  });
});

describe('EquipmentService.updateEquipment', () => {
  it('records before/after for each modified field, including a category change', async () => {
    const equipment = world.addEquipment({ name: 'Viejo', categoryId: categoryId() });
    const newCategory = world.categories[1]!['id'] as string;

    const updated = await equipmentService.updateEquipment(
      equipment['id'] as string,
      { name: 'Nuevo', categoryId: newCategory },
      ADMIN.id,
    );

    expect(updated).toMatchObject({ name: 'Nuevo', categoryId: newCategory, categoryName: 'Proyectores' });
    expect(db.tx.equipment.update.mock.calls[0]![0].data).toEqual({
      name: 'Nuevo',
      category: { connect: { id: newCategory } },
    });
    expect(world.events).toHaveLength(1);
    expect(world.events[0]!['changedFields']).toEqual([
      { field: 'name', before: 'Viejo', after: 'Nuevo' },
      { field: 'categoryId', before: categoryId(), after: newCategory },
    ]);
  });

  it('returns the equipment untouched and records nothing when no value really changes', async () => {
    const equipment = world.addEquipment({ name: 'Igual' });

    const result = await equipmentService.updateEquipment(equipment['id'] as string, { name: 'Igual' }, ADMIN.id);

    expect(result.name).toBe('Igual');
    expect(writeCallCount(db)).toBe(0);
  });

  it('allows keeping the same serial number', async () => {
    const equipment = world.addEquipment({ serialNumber: 'SAME-1', name: 'A' });

    await equipmentService.updateEquipment(
      equipment['id'] as string,
      { serialNumber: 'SAME-1', name: 'B' },
      ADMIN.id,
    );

    expect(equipment['name']).toBe('B');
  });

  it('rejects updates on soft-deleted equipment', async () => {
    const equipment = world.addEquipment({ deletedAt: new Date() });

    await expect(
      equipmentService.updateEquipment(equipment['id'] as string, { name: 'X' }, ADMIN.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects moving to a category that does not exist', async () => {
    const equipment = world.addEquipment();

    const error = await equipmentService
      .updateEquipment(
        equipment['id'] as string,
        { categoryId: 'c0000000-0000-4000-8000-0000000000ff' },
        ADMIN.id,
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(writeCallCount(db)).toBe(0);
  });

  it('rejects an empty PATCH body over HTTP', async () => {
    const equipment = world.addEquipment();

    const res = await request(server)
      .patch(`/api/v1/equipment/${String(equipment['id'])}`)
      .set('Authorization', bearer(ADMIN))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Debe indicar al menos un campo para actualizar');
  });
});

describe('EquipmentService.deleteEquipment (Req 1.8, 1.9)', () => {
  it('soft-deletes available equipment and records EQUIPMENT_DELETED', async () => {
    const equipment = world.addEquipment();

    await equipmentService.deleteEquipment(equipment['id'] as string, ADMIN.id);

    expect(equipment['deletedAt']).toBeInstanceOf(Date);
    expect(world.equipment).toHaveLength(1); // soft, not hard
    expect(world.events).toEqual([
      expect.objectContaining({ eventType: 'EQUIPMENT_DELETED', entityId: equipment['id'] }),
    ]);
  });

  it('rejects removing equipment with an active loan, with the specified message', async () => {
    const { equipment } = world.addActiveLoan({
      startDate: new Date('2026-01-01T00:00:00Z'),
      agreedReturnDate: new Date('2026-01-05T00:00:00Z'),
    });

    const error = await equipmentService
      .deleteEquipment(equipment['id'] as string, ADMIN.id)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe(
      'El equipo tiene un préstamo activo y no puede ser eliminado',
    );
    expect(equipment['deletedAt']).toBeNull();
    expect(writeCallCount(db)).toBe(0);
  });

  it('also refuses when the equipment is marked PRESTADO even without a loan row', async () => {
    const equipment = world.addEquipment({ status: 'PRESTADO' });

    await expect(
      equipmentService.deleteEquipment(equipment['id'] as string, ADMIN.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows removal once the loan is finished', async () => {
    const { equipment, loan } = world.addActiveLoan({
      startDate: new Date('2026-01-01T00:00:00Z'),
      agreedReturnDate: new Date('2026-01-05T00:00:00Z'),
    });
    loan['status'] = 'FINALIZADO';
    equipment['status'] = 'DISPONIBLE';

    await equipmentService.deleteEquipment(equipment['id'] as string, ADMIN.id);

    expect(equipment['deletedAt']).toBeInstanceOf(Date);
  });

  it('answers 404 for unknown or already deleted equipment', async () => {
    const deleted = world.addEquipment({ deletedAt: new Date() });

    await expect(
      equipmentService.deleteEquipment('e0000000-0000-4000-8000-0000000000ff', ADMIN.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      equipmentService.deleteEquipment(deleted['id'] as string, ADMIN.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('EquipmentService reads', () => {
  it('excludes soft-deleted equipment from the inventory and the detail', async () => {
    const kept = world.addEquipment({ name: 'Visible' });
    const gone = world.addEquipment({ name: 'Eliminado', deletedAt: new Date() });

    const listed = await equipmentService.listEquipment({ page: 1, limit: 50 });

    expect(listed.data.map((e) => e.id)).toEqual([kept['id']]);
    expect(listed.meta).toEqual({ page: 1, limit: 50, total: 1 });
    await expect(equipmentService.getEquipmentById(gone['id'] as string)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('returns ISO dates and the category name in the detail', async () => {
    const equipment = world.addEquipment({
      createdAt: new Date('2026-03-01T10:00:00Z'),
      updatedAt: new Date('2026-03-02T11:30:00Z'),
    });

    const detail = await equipmentService.getEquipmentById(equipment['id'] as string);

    expect(detail).toMatchObject({
      categoryName: 'Laptops',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-02T11:30:00.000Z',
    });
  });

  it('rejects inventory pages larger than 50 over HTTP', async () => {
    const res = await request(server)
      .get('/api/v1/equipment?limit=51')
      .set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(400);
  });

  it('serves the history of soft-deleted equipment, and 404 for unknown equipment', async () => {
    const equipment = world.addEquipment({ deletedAt: new Date() });
    world.events.push({
      id: 'h1',
      eventType: 'EQUIPMENT_DELETED',
      entityId: equipment['id'],
      entityTable: 'Equipment',
      userId: ADMIN.id,
      occurredAt: new Date(),
      changedFields: null,
      equipmentId: equipment['id'],
      requestId: null,
      loanId: null,
    });

    const history = await equipmentService.listEquipmentHistory(equipment['id'] as string, {
      page: 1,
      limit: 100,
    });

    expect(history.data).toHaveLength(1);
    await expect(
      equipmentService.listEquipmentHistory('e0000000-0000-4000-8000-0000000000ff', {
        page: 1,
        limit: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
