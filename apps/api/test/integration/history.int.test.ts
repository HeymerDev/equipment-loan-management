// Task 9.3 (integration) — history queries against a real PostgreSQL database,
// including the database-backed halves of Properties 20, 21 and 23.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { EventType, type User } from '@prisma/client';
import { prisma } from '../../src/config/prisma.js';
import { equipmentService, type EquipmentDto } from '../../src/modules/equipment/equipment.service.js';
import { historyQueryService } from '../../src/modules/history/history.service.js';
import { historyQuerySchema } from '../../src/modules/history/history.schema.js';
import { cleanup, createFixtures, createUser, serial, type Fixtures } from './db.js';

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WINDOW_START = Date.UTC(2031, 5, 1); // far from any real data
const DAY_MS = 86_400_000;

let fx: Fixtures;
/** Equipment and users that only the synthetic dataset below refers to. */
let datasetEquipment: EquipmentDto[];
let datasetUsers: User[];
let dataset: Array<{ id: string; eventType: EventType; equipmentId: string; userId: string; occurredAt: Date }>;

beforeAll(async () => {
  fx = await createFixtures();
  datasetEquipment = await Promise.all(
    ['DSA', 'DSB'].map((label) =>
      equipmentService.createEquipment(
        { name: `Dataset ${label}`, serialNumber: serial(label), description: 'Dataset', categoryId: fx.category.id },
        fx.admin.id,
      ),
    ),
  );
  datasetUsers = await Promise.all([createUser('ds1', 'ADMINISTRADOR'), createUser('ds2', 'DOCENTE')]);

  // 180 entries spread over 12 days, with some exact midnights and last milliseconds.
  const rng = fc.sample(
    fc.record({
      eventType: fc.constantFrom(...Object.values(EventType)),
      equipment: fc.integer({ min: 0, max: 1 }),
      user: fc.integer({ min: 0, max: 1 }),
      offset: fc.oneof(
        fc.integer({ min: 0, max: 12 * DAY_MS - 1 }),
        fc.integer({ min: 0, max: 11 }).map((d) => d * DAY_MS),
        fc.integer({ min: 1, max: 12 }).map((d) => d * DAY_MS - 1),
      ),
    }),
    { numRuns: 180, seed: 20310601 },
  );
  await prisma.historyEvent.createMany({
    data: rng.map((spec) => ({
      eventType: spec.eventType,
      entityId: datasetEquipment[spec.equipment]!.id,
      entityTable: 'Equipment',
      userId: datasetUsers[spec.user]!.id,
      equipmentId: datasetEquipment[spec.equipment]!.id,
      occurredAt: new Date(WINDOW_START + spec.offset),
    })),
  });
  dataset = await prisma.historyEvent.findMany({
    where: { equipmentId: { in: datasetEquipment.map((e) => e.id) }, occurredAt: { gte: new Date(WINDOW_START) } },
    select: { id: true, eventType: true, equipmentId: true, userId: true, occurredAt: true },
  }) as typeof dataset;
});

afterAll(async () => {
  await cleanup();
});

describe('history on PostgreSQL', () => {
  it('Feature: equipment-loan-management, Property 20 (PostgreSQL): las entradas escritas por los servicios traen todos los campos y una marca ISO 8601 de la base', async () => {
    const created = await equipmentService.createEquipment(
      { name: 'Auditado', serialNumber: serial('P20'), description: 'x', categoryId: fx.category.id },
      fx.admin.id,
    );
    await equipmentService.updateEquipment(created.id, { name: 'Auditado v2', description: 'y' }, fx.admin.id);
    await equipmentService.deleteEquipment(created.id, fx.admin.id);

    const { data } = await historyQueryService.listEvents({ equipmentId: created.id, page: 1, limit: 100 });

    expect(data.map((e) => e.eventType)).toEqual(['EQUIPMENT_DELETED', 'EQUIPMENT_UPDATED', 'EQUIPMENT_CREATED']);
    for (const entry of data) {
      expect(entry.entityId).toBe(created.id);
      expect(entry.userId).toBe(fx.admin.id);
      expect(entry.occurredAt).toMatch(ISO_8601);
    }
    expect(data[1]!.changedFields).toEqual([
      { field: 'name', before: 'Auditado', after: 'Auditado v2' },
      { field: 'description', before: 'x', after: 'y' },
    ]);
  });

  it('treats the date range as whole inclusive days on real timestamps', async () => {
    const equipmentId = datasetEquipment[0]!.id;
    const at = (iso: string) =>
      prisma.historyEvent.create({
        data: {
          eventType: 'EQUIPMENT_UPDATED',
          entityId: equipmentId,
          entityTable: 'Equipment',
          userId: fx.admin.id,
          equipmentId,
          occurredAt: new Date(iso),
        },
      });
    await at('2032-03-09T23:59:59.999Z');
    const first = await at('2032-03-10T00:00:00.000Z');
    const last = await at('2032-03-12T23:59:59.999Z');
    await at('2032-03-13T00:00:00.000Z');

    const result = await historyQueryService.listEvents(
      historyQuerySchema.parse({ equipmentId, userId: fx.admin.id, startDate: '2032-03-10', endDate: '2032-03-12' }),
    );

    expect(result.data.map((e) => e.id).sort()).toEqual([first.id, last.id].sort());
  });

  it('Feature: equipment-loan-management, Property 21 (PostgreSQL): los filtros combinados se aplican a la vez en consultas reales', async () => {
    const dayArb = fc.integer({ min: -1, max: 13 }).map((d) => new Date(WINDOW_START + d * DAY_MS).toISOString().slice(0, 10));
    const filtersArb = fc
      .record(
        {
          eventType: fc.constantFrom(...Object.values(EventType)),
          equipmentId: fc.constantFrom(...datasetEquipment.map((e) => e.id)),
          userId: fc.constantFrom(...datasetUsers.map((u) => u.id)),
          startDate: dayArb,
          endDate: dayArb,
        },
        { requiredKeys: [] },
      )
      // Always scoped to the dataset, so the oracle knows every candidate row.
      .filter((f) => f.equipmentId !== undefined || f.userId !== undefined)
      // Keep the dataset's own window, away from rows written by other tests…
      .map((f) => ({ ...f, startDate: f.startDate ?? new Date(WINDOW_START).toISOString().slice(0, 10) }))
      // …and only then drop inverted ranges, which Property 24 covers.
      .filter((f) => f.endDate === undefined || f.startDate <= f.endDate);

    await fc.assert(
      fc.asyncProperty(filtersArb, async (filters) => {
        const results: Array<{ id: string }> = [];
        for (let page = 1; ; page++) {
          const result = await historyQueryService.listEvents(historyQuerySchema.parse({ ...filters, page, limit: 100 }));
          results.push(...result.data);
          if (result.data.length < 100) break;
        }

        const expected = dataset.filter((row) => {
          const day = row.occurredAt.toISOString().slice(0, 10);
          return (
            (filters.eventType === undefined || row.eventType === filters.eventType) &&
            (filters.equipmentId === undefined || row.equipmentId === filters.equipmentId) &&
            (filters.userId === undefined || row.userId === filters.userId) &&
            day >= filters.startDate &&
            (filters.endDate === undefined || day <= filters.endDate)
          );
        });
        expect(results.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
      }),
      { numRuns: 20 },
    );
  });

  it('Feature: equipment-loan-management, Property 23 (PostgreSQL): páginas de hasta 100 registros, del más reciente al más antiguo', async () => {
    const userId = datasetUsers[0]!.id;
    const expectedTotal = dataset.filter((row) => row.userId === userId).length;
    const pages: Array<Array<{ id: string; occurredAt: string }>> = [];
    for (let page = 1; ; page++) {
      const result = await historyQueryService.listEvents({ userId, page, limit: 100 });
      expect(result.meta.total).toBe(expectedTotal);
      pages.push(result.data);
      if (result.data.length < 100) break;
    }

    const flat = pages.flat();
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(100);
    expect(flat).toHaveLength(expectedTotal);
    expect(new Set(flat.map((e) => e.id)).size).toBe(expectedTotal);
    for (let i = 1; i < flat.length; i++) expect(flat[i - 1]!.occurredAt >= flat[i]!.occurredAt).toBe(true);
  });
});
