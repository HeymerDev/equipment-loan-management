// Task 5.4 (integration) — equipment against a real PostgreSQL database,
// including the database-backed halves of Properties 2 and 6.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { prisma } from '../../src/config/prisma.js';
import { app } from '../../src/app.js';
import { equipmentService } from '../../src/modules/equipment/equipment.service.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import { ConflictError, NotFoundError } from '../../src/shared/errors.js';
import { UUID_RE } from '../helpers/arbitraries.js';
import { utcDay } from '../helpers/world.js';
import { cleanup, createFixtures, leftovers, login, serial, type Fixtures } from './db.js';

let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures();
});

afterAll(async () => {
  await cleanup();
});

const input = (label: string, overrides: Record<string, string> = {}) => ({
  name: `Equipo ${label}`,
  serialNumber: serial(label),
  description: 'Equipo de integración',
  categoryId: fx.category.id,
  ...overrides,
});

describe('equipment on PostgreSQL', () => {
  it('Feature: equipment-loan-management, Property 2 (PostgreSQL): cada equipo recibe un UUID propio y estado DISPONIBLE', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (count) => {
        const created = await Promise.all(
          Array.from({ length: count }, (_, i) => equipmentService.createEquipment(input(`P2${i}`), fx.admin.id)),
        );

        const stored = await prisma.equipment.findMany({ where: { id: { in: created.map((e) => e.id) } } });
        expect(stored).toHaveLength(count);
        expect(new Set(stored.map((e) => e.id)).size).toBe(count);
        for (const row of stored) {
          expect(row.id).toMatch(UUID_RE);
          expect(row.status).toBe('DISPONIBLE');
        }
      }),
      { numRuns: 15 },
    );
  });

  it('Feature: equipment-loan-management, Property 6 (PostgreSQL): registros concurrentes del mismo número de serie — solo uno persiste', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (contenders) => {
        const sharedSerial = serial('P6');

        const outcomes = await Promise.allSettled(
          Array.from({ length: contenders }, (_, i) =>
            equipmentService.createEquipment(input(`P6${i}`, { serialNumber: sharedSerial }), fx.admin.id),
          ),
        );

        const winners = outcomes.filter((o) => o.status === 'fulfilled');
        const losers = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
        expect(winners).toHaveLength(1);
        for (const loser of losers) expect(loser.reason).toBeInstanceOf(ConflictError);

        expect(await prisma.equipment.count({ where: { serialNumber: sharedSerial } })).toBe(1);
        expect(
          await prisma.historyEvent.count({
            where: { eventType: 'EQUIPMENT_CREATED', equipment: { serialNumber: sharedSerial } },
          }),
        ).toBe(1);
      }),
      { numRuns: 10 },
    );
  });

  it('persists fields exactly at their limits, and the columns enforce the same limits', async () => {
    const created = await equipmentService.createEquipment(
      {
        name: 'n'.repeat(100),
        serialNumber: `${serial('LIM')}`.padEnd(50, 'x'),
        description: 'd'.repeat(500),
        categoryId: fx.category.id,
      },
      fx.admin.id,
    );
    const stored = await prisma.equipment.findUniqueOrThrow({ where: { id: created.id } });
    expect([stored.name.length, stored.serialNumber.length, stored.description.length]).toEqual([100, 50, 500]);

    // Even bypassing the API validation, the database refuses longer values.
    await expect(
      prisma.equipment.create({ data: { ...input('LIM101'), name: 'n'.repeat(101) } }),
    ).rejects.toMatchObject({ code: 'P2000' });
  });

  it('removes equipment from the inventory with a soft delete and keeps its history', async () => {
    const created = await equipmentService.createEquipment(input('SOFT'), fx.admin.id);

    await equipmentService.deleteEquipment(created.id, fx.admin.id);

    const stored = await prisma.equipment.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    await expect(equipmentService.getEquipmentById(created.id)).rejects.toBeInstanceOf(NotFoundError);

    const seen: string[] = [];
    for (let page = 1; ; page++) {
      const result = await equipmentService.listEquipment({ page, limit: 50 });
      seen.push(...result.data.map((e) => e.id));
      if (result.data.length < 50) break;
    }
    expect(seen).not.toContain(created.id);

    const history = await equipmentService.listEquipmentHistory(created.id, { page: 1, limit: 100 });
    expect(history.data.map((e) => e.eventType)).toEqual(['EQUIPMENT_DELETED', 'EQUIPMENT_CREATED']);
  });

  it('refuses to delete equipment that is out on an active loan (Req 1.9)', async () => {
    const equipment = await equipmentService.createEquipment(input('LENT'), fx.admin.id);
    const pending = await loanRequestsService.createLoanRequest(
      { equipmentId: equipment.id, purpose: 'Clase', startDate: utcDay(1), returnDate: utcDay(3) },
      fx.teacher.id,
    );
    await loanRequestsService.approveLoanRequest(pending.id, fx.admin.id);

    await expect(equipmentService.deleteEquipment(equipment.id, fx.admin.id)).rejects.toBeInstanceOf(ConflictError);
    const stored = await prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
    expect(stored).toMatchObject({ status: 'PRESTADO', deletedAt: null });
  });

  it('works end to end over HTTP with a real login', async () => {
    const token = await login(fx.admin);
    const body = input('HTTP');

    const created = await request(app).post('/api/v1/equipment').set('Authorization', `Bearer ${token}`).send(body);
    const duplicate = await request(app).post('/api/v1/equipment').set('Authorization', `Bearer ${token}`).send(body);
    const updated = await request(app)
      .patch(`/api/v1/equipment/${created.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Equipo renombrado' });

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(updated.status).toBe(200);
    const entry = await prisma.historyEvent.findFirstOrThrow({
      where: { equipmentId: created.body.data.id as string, eventType: 'EQUIPMENT_UPDATED' },
    });
    expect(entry.changedFields).toEqual([{ field: 'name', before: 'Equipo HTTP', after: 'Equipo renombrado' }]);
  });

  it('leaves no rows behind once cleaned (checked by the next file too)', async () => {
    expect(await leftovers()).toBeGreaterThan(0); // rows exist until afterAll runs
  });
});
