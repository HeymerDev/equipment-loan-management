// Task 5.3 — property tests for the equipment module (Properties 1–7).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Prisma } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});
// Approvals try to render the voucher; that is covered by the PDF suites.
vi.mock('../../src/modules/pdf/pdf.service.js', () => ({
  pdfService: { generateVoucher: vi.fn(async () => Buffer.from('%PDF-')) },
}));

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { equipmentService } from '../../src/modules/equipment/equipment.service.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import {
  createEquipmentSchema,
  listEquipmentQuerySchema,
  updateEquipmentSchema,
} from '../../src/modules/equipment/equipment.schema.js';
import { ConflictError, NotFoundError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, OTHER_TEACHER, TEACHER, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';
import { UUID_RE, equipmentInputArb, periodArb, textArb } from '../helpers/arbitraries.js';

const db = prisma as unknown as PrismaMock;

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

const FIELDS = ['name', 'serialNumber', 'description', 'categoryId'] as const;
type Field = (typeof FIELDS)[number];
const LIMITS: Record<Exclude<Field, 'categoryId'>, number> = {
  name: 100,
  serialNumber: 50,
  description: 500,
};

interface Breakage {
  kind: 'missing' | 'blank' | 'too-long' | 'not-uuid' | 'wrong-type';
  value?: unknown;
}

function breakageArb(field: Field, allowMissing: boolean): fc.Arbitrary<Breakage> {
  const options: fc.Arbitrary<Breakage>[] = [
    fc.stringMatching(/^[ \t\n]{0,5}$/).map((value) => ({ kind: 'blank' as const, value })),
    fc
      .oneof(fc.integer(), fc.boolean(), fc.constant(null))
      .map((value) => ({ kind: 'wrong-type' as const, value })),
  ];
  if (allowMissing) options.push(fc.constant({ kind: 'missing' as const }));
  if (field === 'categoryId') {
    options.push(
      fc
        .string({ unit: 'grapheme-ascii', maxLength: 40 })
        .filter((value) => !UUID_RE.test(value))
        .map((value) => ({ kind: 'not-uuid' as const, value })),
    );
  } else {
    const limit = LIMITS[field];
    options.push(
      fc
        .integer({ min: limit + 1, max: limit + 60 })
        .map((length) => ({ kind: 'too-long' as const, value: 'x'.repeat(length) })),
    );
  }
  return fc.oneof(...options);
}

const brokenFieldArb = (allowMissing: boolean) =>
  fc
    .constantFrom(...FIELDS)
    .chain((field) => breakageArb(field, allowMissing).map((breakage) => ({ field, breakage })));

function applyBreakage(body: Row, field: Field, breakage: Breakage): Row {
  const broken: Row = { ...body };
  if (breakage.kind === 'missing') delete broken[field];
  else broken[field] = breakage.value;
  return broken;
}

describe('equipment properties', () => {
  it('Feature: equipment-loan-management, Property 1: Validación universal de campos de equipo', async () => {
    // Valid objects are accepted for creation, and any non-empty subset for update.
    fc.assert(
      fc.property(equipmentInputArb, fc.subarray([...FIELDS], { minLength: 1 }), (input, keys) => {
        expect(createEquipmentSchema.safeParse(input).success).toBe(true);
        const partial = Object.fromEntries(keys.map((key) => [key, input[key]]));
        expect(updateEquipmentSchema.safeParse(partial).success).toBe(true);
      }),
      { numRuns: 100 },
    );

    // Creation: one missing, blank, oversized or mistyped field → 400 naming that
    // field, and nothing is written.
    await fc.assert(
      fc.asyncProperty(equipmentInputArb, brokenFieldArb(true), async (input, { field, breakage }) => {
        resetPrismaMock(db);
        new World(db);
        const body = applyBreakage(input, field, breakage);

        const parsed = createEquipmentSchema.safeParse(body);
        expect(parsed.success).toBe(false);

        const res = await request(server)
          .post('/api/v1/equipment')
          .set('Authorization', bearer(ADMIN))
          .send(body);

        expect(res.status, `${field} ${breakage.kind}`).toBe(400);
        expect(res.body.error.field).toBe(field);
        expect(writeCallCount(db)).toBe(0);
      }),
      { numRuns: 100 },
    );

    // Update: same rule for a partial body, and the stored equipment is untouched.
    await fc.assert(
      fc.asyncProperty(equipmentInputArb, brokenFieldArb(false), async (input, { field, breakage }) => {
        resetPrismaMock(db);
        const world = new World(db);
        const equipment = world.addEquipment();
        const snapshot = { ...equipment };

        const res = await request(server)
          .patch(`/api/v1/equipment/${String(equipment['id'])}`)
          .set('Authorization', bearer(ADMIN))
          .send(applyBreakage({ [field]: input[field] }, field, breakage));

        expect(res.status).toBe(400);
        expect(res.body.error.field).toBe(field);
        expect(writeCallCount(db)).toBe(0);
        expect({ ...equipment }).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 2: Unicidad de identificadores y estado inicial al crear equipo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(equipmentInputArb, {
          minLength: 1,
          maxLength: 15,
          selector: (input) => input.serialNumber,
        }),
        async (inputs) => {
          resetPrismaMock(db);
          const world = new World(db);
          const categoryId = world.categories[0]!['id'] as string;

          const created = [];
          for (const input of inputs) {
            created.push(await equipmentService.createEquipment({ ...input, categoryId }, ADMIN.id));
          }

          // The service never chooses the id and always starts at DISPONIBLE…
          for (const [args] of db.tx.equipment.create.mock.calls) {
            expect(args.data).not.toHaveProperty('id');
            expect(args.data.status).toBe('DISPONIBLE');
          }
          // …so every piece of equipment ends up with its own id and that status.
          expect(new Set(created.map((e) => e.id)).size).toBe(inputs.length);
          expect(created.every((e) => e.status === 'DISPONIBLE')).toBe(true);

          const creations = world.events.filter((e) => e['eventType'] === 'EQUIPMENT_CREATED');
          expect(creations.map((e) => e['entityId']).sort()).toEqual(created.map((e) => e.id).sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 3: El historial registra todos los campos modificados en actualizaciones', async () => {
    const scenarioArb = equipmentInputArb.chain((current) => {
      // Each field is either left out, set to its current value, or changed.
      const choice = <T>(currentValue: T, fresh: fc.Arbitrary<T>) =>
        fc.option(fc.oneof(fc.constant(currentValue), fresh), { nil: undefined });
      return fc
        .record({
          name: choice(current.name, textArb(100)),
          serialNumber: choice(current.serialNumber, textArb(50)),
          description: choice(current.description, textArb(500)),
          categoryIndex: fc.option(fc.integer({ min: 0, max: 1 }), { nil: undefined }),
        })
        .map((update) => ({ current, update }));
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ current, update }) => {
        resetPrismaMock(db);
        const world = new World(db);
        const equipment = world.addEquipment({ ...current, categoryId: world.categories[0]!['id'] });
        const before = { ...equipment };

        const input = {
          ...(update.name !== undefined && { name: update.name }),
          ...(update.serialNumber !== undefined && { serialNumber: update.serialNumber }),
          ...(update.description !== undefined && { description: update.description }),
          ...(update.categoryIndex !== undefined && {
            categoryId: world.categories[update.categoryIndex]!['id'] as string,
          }),
        };

        await equipmentService.updateEquipment(before['id'] as string, input, ADMIN.id);

        // Oracle: the fields whose new value differs from the stored one.
        const expected = FIELDS.filter(
          (field) =>
            (input as Record<string, unknown>)[field] !== undefined &&
            (input as Record<string, unknown>)[field] !== before[field],
        ).map((field) => ({
          field,
          before: before[field],
          after: (input as Record<string, unknown>)[field],
        }));

        const updates = world.events.filter((e) => e['eventType'] === 'EQUIPMENT_UPDATED');
        if (expected.length === 0) {
          expect(updates).toHaveLength(0);
          expect(db.tx.equipment.update).not.toHaveBeenCalled();
        } else {
          expect(updates).toHaveLength(1);
          expect(updates[0]!['changedFields']).toEqual(expected);
          expect(updates[0]!['entityId']).toBe(before['id']);
          for (const { field, after } of expected) expect(equipment[field]).toBe(after);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 4: Invariante de estado del equipo con préstamo activo', async () => {
    // Equipment with an ACTIVO loan cannot take another loan nor be removed.
    await fc.assert(
      fc.asyncProperty(
        periodArb({ minStart: -30, maxStart: 30 }),
        periodArb({ minStart: 0, maxStart: 60 }),
        async (loanPeriod, requestedPeriod) => {
          resetPrismaMock(db);
          const world = new World(db);
          const { equipment } = world.addActiveLoan({
            startDate: loanPeriod.startDate,
            agreedReturnDate: loanPeriod.endDate,
          });
          const pending = world.addRequest({
            equipmentId: equipment['id'],
            teacherId: OTHER_TEACHER.id,
            startDate: requestedPeriod.startDate,
            returnDate: requestedPeriod.endDate,
          });

          const approval = await loanRequestsService
            .approveLoanRequest(pending['id'] as string, ADMIN.id)
            .catch((e: unknown) => e);
          const removal = await equipmentService
            .deleteEquipment(equipment['id'] as string, ADMIN.id)
            .catch((e: unknown) => e);

          expect(approval).toBeInstanceOf(ConflictError);
          expect(removal).toBeInstanceOf(ConflictError);
          expect(writeCallCount(db)).toBe(0);
          expect(equipment['status']).toBe('PRESTADO');
          expect(equipment['deletedAt']).toBeNull();
          expect(pending['status']).toBe('PENDIENTE');
          expect(world.loans.filter((l) => l['status'] === 'ACTIVO')).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );

    // And whenever an approval creates the ACTIVO loan, the equipment becomes
    // PRESTADO in that very transaction.
    await fc.assert(
      fc.asyncProperty(periodArb({ minStart: 0, maxStart: 60 }), async (period) => {
        resetPrismaMock(db);
        const world = new World(db);
        const equipment = world.addEquipment();
        const pending = world.addRequest({
          equipmentId: equipment['id'],
          startDate: period.startDate,
          returnDate: period.endDate,
        });

        await loanRequestsService.approveLoanRequest(pending['id'] as string, ADMIN.id);

        expect(db.$transaction).toHaveBeenCalledTimes(1);
        expect(db.tx.loan.create).toHaveBeenCalledTimes(1);
        expect(db.tx.equipment.update).toHaveBeenCalledWith({
          where: { id: equipment['id'] },
          data: { status: 'PRESTADO' },
        });
        expect(db.loan.create).not.toHaveBeenCalled();
        expect(db.equipment.update).not.toHaveBeenCalled();

        const active = world.loans.filter(
          (l) => l['equipmentId'] === equipment['id'] && l['status'] === 'ACTIVO',
        );
        expect(active).toHaveLength(1);
        expect(equipment['status']).toBe('PRESTADO');
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 5: Paginación y campos requeridos en consultas de inventario', async () => {
    fc.assert(
      fc.property(fc.integer({ min: 51, max: 100_000 }), (limit) => {
        expect(listEquipmentQuerySchema.safeParse({ limit }).success).toBe(false);
      }),
      { numRuns: 100 },
    );

    const inventoryArb = fc.array(
      fc.record({
        name: textArb(30),
        deleted: fc.boolean(),
        status: fc.constantFrom('DISPONIBLE', 'PRESTADO'),
        categoryIndex: fc.integer({ min: 0, max: 1 }),
      }),
      { maxLength: 130 },
    );

    await fc.assert(
      fc.asyncProperty(
        inventoryArb,
        fc.integer({ min: 1, max: 50 }),
        fc.option(fc.constantFrom('DISPONIBLE' as const, 'PRESTADO' as const), { nil: undefined }),
        async (items, limit, status) => {
          resetPrismaMock(db);
          const world = new World(db);
          for (const item of items) {
            world.addEquipment({
              name: item.name,
              status: item.status,
              deletedAt: item.deleted ? new Date() : null,
              categoryId: world.categories[item.categoryIndex]!['id'],
            });
          }
          const expected = world.equipment.filter(
            (e) => e['deletedAt'] === null && (status === undefined || e['status'] === status),
          );

          const seen: string[] = [];
          for (let page = 1; page <= 200; page++) {
            const query = listEquipmentQuerySchema.parse({ page, limit, status });
            const result = await equipmentService.listEquipment(query);

            expect(result.data.length).toBeLessThanOrEqual(Math.min(limit, 50));
            expect(result.meta.total).toBe(expected.length);
            for (const item of result.data) {
              const stored = world.equipment.find((e) => e['id'] === item.id)!;
              expect(item.name).toBe(stored['name']);
              expect(item.serialNumber).toBe(stored['serialNumber']);
              expect(item.status).toBe(stored['status']);
              expect(item.categoryName).toBe((stored['category'] as Row)['name']);
            }
            seen.push(...result.data.map((item) => item.id));
            if (result.data.length < limit) break;
          }

          // Walking every page returns each listed item exactly once.
          expect(seen.slice().sort()).toEqual(expected.map((e) => e['id'] as string).sort());
          expect(new Set(seen).size).toBe(seen.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 6: Unicidad del número de serie', async () => {
    // Pre-checked duplicate (the holder may even be soft-deleted).
    await fc.assert(
      fc.asyncProperty(equipmentInputArb, fc.boolean(), async (input, holderDeleted) => {
        resetPrismaMock(db);
        const world = new World(db);
        world.addEquipment({
          serialNumber: input.serialNumber,
          deletedAt: holderDeleted ? new Date() : null,
        });

        const error = await equipmentService
          .createEquipment({ ...input, categoryId: world.categories[0]!['id'] as string }, ADMIN.id)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictError);
        expect(world.equipment).toHaveLength(1);
        expect(world.events).toHaveLength(0);
        expect(writeCallCount(db)).toBe(0);
      }),
      { numRuns: 100 },
    );

    // A concurrent insert that slips past the check hits the unique index; the
    // service still answers 409 and records nothing.
    await fc.assert(
      fc.asyncProperty(equipmentInputArb, async (input) => {
        resetPrismaMock(db);
        const world = new World(db);
        db.tx.equipment.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed on serialNumber', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );

        const error = await equipmentService
          .createEquipment({ ...input, categoryId: world.categories[0]!['id'] as string }, ADMIN.id)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictError);
        expect(world.events).toHaveLength(0);
      }),
      { numRuns: 100 },
    );

    // Renaming a serial onto one that is already taken is rejected too.
    await fc.assert(
      fc.asyncProperty(textArb(50), textArb(50), async (takenSerial, ownSerial) => {
        fc.pre(takenSerial !== ownSerial);
        resetPrismaMock(db);
        const world = new World(db);
        world.addEquipment({ serialNumber: takenSerial });
        const target = world.addEquipment({ serialNumber: ownSerial });

        const error = await equipmentService
          .updateEquipment(target['id'] as string, { serialNumber: takenSerial }, ADMIN.id)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictError);
        expect(target['serialNumber']).toBe(ownSerial);
        expect(writeCallCount(db)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 7: Equipo eliminado no aparece en inventario activo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(textArb(30), { minLength: 1, maxLength: 20 }),
        fc.nat(),
        async (names, pick) => {
          resetPrismaMock(db);
          const world = new World(db);
          const items = names.map((name) => world.addEquipment({ name }));
          const target = items[pick % items.length]!;
          const pending = world.addRequest({ equipmentId: target['id'] });

          await equipmentService.deleteEquipment(target['id'] as string, ADMIN.id);

          expect(target['deletedAt']).toBeInstanceOf(Date);
          expect(
            world.events.filter(
              (e) => e['eventType'] === 'EQUIPMENT_DELETED' && e['entityId'] === target['id'],
            ),
          ).toHaveLength(1);

          // Gone from the inventory…
          const listed = await equipmentService.listEquipment({ page: 1, limit: 50 });
          expect(listed.data.some((e) => e.id === target['id'])).toBe(false);
          expect(listed.meta.total).toBe(items.length - 1);
          await expect(
            equipmentService.getEquipmentById(target['id'] as string),
          ).rejects.toBeInstanceOf(NotFoundError);

          // …and out of reach for new requests and loans.
          const writesBefore = writeCallCount(db);
          const newRequest = await loanRequestsService
            .createLoanRequest(
              {
                equipmentId: target['id'] as string,
                purpose: 'Clase',
                startDate: utcDay(1),
                returnDate: utcDay(2),
              },
              TEACHER.id,
            )
            .catch((e: unknown) => e);
          const approval = await loanRequestsService
            .approveLoanRequest(pending['id'] as string, ADMIN.id)
            .catch((e: unknown) => e);

          expect(newRequest).toBeInstanceOf(NotFoundError);
          expect(approval).toBeInstanceOf(ConflictError);
          expect(writeCallCount(db)).toBe(writesBefore);
          expect(world.loans).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Keeps `randomUUID` referenced for readers extending these scenarios.
void randomUUID;
