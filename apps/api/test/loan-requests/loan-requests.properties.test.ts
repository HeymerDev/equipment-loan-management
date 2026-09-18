// Task 6.3 — property tests for loan requests (Properties 8–14).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type Mock } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/modules/pdf/pdf.service.js', () => ({
  pdfService: { generateVoucher: vi.fn(async () => Buffer.from('%PDF-')) },
}));

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import {
  listLoanRequestsQuerySchema,
  myLoanRequestsQuerySchema,
} from '../../src/modules/loan-requests/loan-requests.schema.js';
import { pdfService } from '../../src/modules/pdf/pdf.service.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, OTHER_TEACHER, TEACHER, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';
import { overlaps, periodArb, type Period } from '../helpers/arbitraries.js';

const db = prisma as unknown as PrismaMock;
const DAY_MS = 86_400_000;
const WRITE_METHODS = ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

const idOf = (row: Row): string => row['id'] as string;

/** Writes made on the root client, i.e. outside any transaction. */
function rootWriteCount(): number {
  let total = 0;
  for (const [key, delegate] of Object.entries(db)) {
    if (key === 'tx' || typeof delegate !== 'object' || delegate === null) continue;
    for (const method of WRITE_METHODS) {
      total += ((delegate as Record<string, Mock>)[method]?.mock.calls.length) ?? 0;
    }
  }
  return total;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

let server: Server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  resetPrismaMock(db);
  vi.mocked(pdfService.generateVoucher).mockReset().mockResolvedValue(Buffer.from('%PDF-'));
});

const statusArb = fc.constantFrom('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA');

describe('loan request properties', () => {
  it('Feature: equipment-loan-management, Property 8: Validación de fechas en solicitudes de préstamo', async () => {
    // Offsets cluster around the boundaries (today, same day) but also roam wide;
    // times of day are random so the day-level normalisation is exercised.
    const offsetArb = fc.oneof(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -400, max: 400 }));
    const timeArb = fc.integer({ min: 0, max: DAY_MS - 1 });

    await fc.assert(
      fc.asyncProperty(offsetArb, timeArb, offsetArb, timeArb, async (start, startMs, end, endMs) => {
        resetPrismaMock(db);
        const world = new World(db);
        const equipment = world.addEquipment();

        const outcome = await settle(
          loanRequestsService.createLoanRequest(
            {
              equipmentId: idOf(equipment),
              purpose: 'Clase de ciencias',
              startDate: new Date(utcDay(start).getTime() + startMs),
              returnDate: new Date(utcDay(end).getTime() + endMs),
            },
            TEACHER.id,
          ),
        );

        if (end <= start) {
          expect(outcome.ok).toBe(false);
          const error = (outcome as { error: ValidationError }).error;
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.field).toBe('returnDate');
          expect(error.message).toBe('La fecha de devolución debe ser posterior a la fecha de inicio');
          expect(writeCallCount(db)).toBe(0);
        } else if (start < 0) {
          expect(outcome.ok).toBe(false);
          const error = (outcome as { error: ValidationError }).error;
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.field).toBe('startDate');
          expect(error.message).toBe('La fecha de inicio no puede ser en el pasado');
          expect(writeCallCount(db)).toBe(0);
        } else {
          expect(outcome.ok).toBe(true);
          const created = (outcome as { value: { status: string; startDate: string; returnDate: string } }).value;
          expect(created.status).toBe('PENDIENTE');
          expect(created.startDate).toBe(utcDay(start).toISOString());
          expect(created.returnDate).toBe(utcDay(end).toISOString());
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Feature: equipment-loan-management, Property 9: Detección de solapamiento de fechas en solicitudes', async () => {
    // Small windows so that overlaps, adjacency and gaps all come up often.
    const loanSpecArb = fc.record({
      period: periodArb({ minStart: -10, maxStart: 20, maxLength: 8 }),
      onTarget: fc.boolean(),
      status: fc.constantFrom('ACTIVO', 'FINALIZADO'),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(loanSpecArb, { maxLength: 6 }),
        periodArb({ minStart: 0, maxStart: 20, maxLength: 8 }),
        async (loanSpecs, requested) => {
          resetPrismaMock(db);
          const world = new World(db);
          const target = world.addEquipment();
          const other = world.addEquipment();

          for (const spec of loanSpecs) {
            const equipment = spec.onTarget ? target : other;
            const holder = world.addRequest({
              equipmentId: equipment['id'],
              status: 'APROBADA',
              startDate: spec.period.startDate,
              returnDate: spec.period.endDate,
            });
            world.addLoan({
              equipmentId: equipment['id'],
              requestId: holder['id'],
              status: spec.status,
              startDate: spec.period.startDate,
              agreedReturnDate: spec.period.endDate,
            });
          }

          // Oracle: an ACTIVO loan on the same equipment sharing at least one day.
          const blocked = loanSpecs.some(
            (spec) => spec.onTarget && spec.status === 'ACTIVO' && overlaps(spec.period, requested),
          );
          const requestsBefore = world.requests.length;

          const outcome = await settle(
            loanRequestsService.createLoanRequest(
              {
                equipmentId: idOf(target),
                purpose: 'Taller',
                startDate: requested.startDate,
                returnDate: requested.endDate,
              },
              TEACHER.id,
            ),
          );

          if (blocked) {
            expect(outcome.ok).toBe(false);
            const error = (outcome as { error: ConflictError }).error;
            expect(error).toBeInstanceOf(ConflictError);
            expect(error.message).toBe('El equipo no está disponible en el período solicitado');
            expect(world.requests).toHaveLength(requestsBefore);
            expect(writeCallCount(db)).toBe(0);
          } else {
            expect(outcome.ok).toBe(true);
            expect(world.requests).toHaveLength(requestsBefore + 1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Feature: equipment-loan-management, Property 10: Cancelación de solicitud pendiente — transición de estado y registro', async () => {
    await fc.assert(
      fc.asyncProperty(
        statusArb,
        fc.boolean(),
        periodArb({ minStart: 0, maxStart: 30 }),
        async (status, byOwner, period) => {
          resetPrismaMock(db);
          const world = new World(db);
          const equipment = world.addEquipment();
          const target = world.addRequest({
            equipmentId: equipment['id'],
            status,
            teacherId: TEACHER.id,
            startDate: period.startDate,
            returnDate: period.endDate,
          });
          const snapshot = { ...target };
          const actor = byOwner ? TEACHER : OTHER_TEACHER;

          const outcome = await settle(loanRequestsService.cancelLoanRequest(idOf(target), actor.id));

          if (!byOwner || status !== 'PENDIENTE') {
            expect(outcome.ok).toBe(false);
            const expected = byOwner ? ConflictError : ForbiddenError;
            expect((outcome as { error: unknown }).error).toBeInstanceOf(expected);
            expect({ ...target }).toEqual(snapshot);
            expect(world.events).toHaveLength(0);
            expect(writeCallCount(db)).toBe(0);
            return;
          }

          expect(outcome.ok).toBe(true);
          expect(target['status']).toBe('CANCELADA');
          expect(target['cancelledAt']).toBeInstanceOf(Date);
          const cancelledAt = (target['cancelledAt'] as Date).toISOString();
          expect((outcome as { value: { cancelledAt?: string } }).value.cancelledAt).toBe(cancelledAt);

          expect(world.events).toHaveLength(1);
          const event = world.events[0]!;
          expect(event).toMatchObject({
            eventType: 'REQUEST_CANCELLED',
            entityId: target['id'],
            requestId: target['id'],
            userId: TEACHER.id,
          });
          // The entry carries the exact instant stored on the request.
          expect(event['changedFields']).toEqual([
            { field: 'status', before: 'PENDIENTE', after: 'CANCELADA' },
            { field: 'cancelledAt', before: null, after: cancelledAt },
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 11: Ordenamiento de consultas de solicitudes', async () => {
    const requestSpecArb = fc.record({
      // A small pool of instants forces ties, which must not break the order.
      createdAt: fc.integer({ min: 0, max: 40 }).map((minutes) => new Date(Date.UTC(2026, 0, 1, 8, minutes))),
      owner: fc.constantFrom(TEACHER.id, OTHER_TEACHER.id),
      status: statusArb,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(requestSpecArb, { maxLength: 60 }),
        fc.integer({ min: 1, max: 100 }),
        async (specs, limit) => {
          resetPrismaMock(db);
          const world = new World(db);
          const equipment = world.addEquipment();
          for (const spec of specs) {
            world.addRequest({
              equipmentId: equipment['id'],
              teacherId: spec.owner,
              status: spec.status,
              createdAt: spec.createdAt,
            });
          }

          async function walk(fetch: (page: number) => Promise<{ data: Array<{ id: string; createdAt: string; status: string; teacherId: string }>; meta: { total: number } }>) {
            const seen: Array<{ id: string; createdAt: string; status: string; teacherId: string }> = [];
            for (let page = 1; page <= 200; page++) {
              const result = await fetch(page);
              expect(result.data.length).toBeLessThanOrEqual(limit);
              seen.push(...result.data);
              if (result.data.length < limit) break;
            }
            return seen;
          }

          const mine = await walk((page) =>
            loanRequestsService.listMyRequests(TEACHER.id, myLoanRequestsQuerySchema.parse({ page, limit })),
          );
          const expectedMine = world.requests.filter((r) => r['teacherId'] === TEACHER.id);
          expect(mine.every((r) => r.teacherId === TEACHER.id)).toBe(true);
          expect(mine.map((r) => r.id).sort()).toEqual(expectedMine.map(idOf).sort());
          for (let i = 1; i < mine.length; i++) {
            expect(mine[i - 1]!.createdAt >= mine[i]!.createdAt).toBe(true);
          }

          const pending = await walk((page) =>
            loanRequestsService.listPendingRequests(listLoanRequestsQuerySchema.parse({ page, limit })),
          );
          const expectedPending = world.requests.filter((r) => r['status'] === 'PENDIENTE');
          expect(pending.every((r) => r.status === 'PENDIENTE')).toBe(true);
          expect(pending.map((r) => r.id).sort()).toEqual(expectedPending.map(idOf).sort());
          for (let i = 1; i < pending.length; i++) {
            expect(pending[i - 1]!.createdAt <= pending[i]!.createdAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 12: Atomicidad de la aprobación de solicitud', async () => {
    type Step =
      | 'none'
      | 'request-update'
      | 'loan-create'
      | 'equipment-update'
      | 'history-approved'
      | 'history-loan-started'
      | 'auto-cancel';

    function failOn(mock: Mock, when: (args: { data: Row }) => boolean, step: Step): void {
      const original = mock.getMockImplementation();
      if (!original) throw new Error(`nothing to wrap for ${step}`);
      mock.mockImplementation(async (args: { data: Row }) => {
        if (when(args)) throw new Error(`injected failure at ${step}`);
        return original(args);
      });
    }

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Step>(
          'none',
          'request-update',
          'loan-create',
          'equipment-update',
          'history-approved',
          'history-loan-started',
          'auto-cancel',
        ),
        periodArb({ minStart: 0, maxStart: 30 }),
        fc.array(periodArb({ minStart: 0, maxStart: 40 }), { maxLength: 4 }),
        async (step, period, otherPeriods) => {
          resetPrismaMock(db);
          vi.mocked(pdfService.generateVoucher).mockClear();
          const world = new World(db);
          const equipment = world.addEquipment();
          const target = world.addRequest({
            equipmentId: equipment['id'],
            startDate: period.startDate,
            returnDate: period.endDate,
          });
          // At least one competing request always overlaps, so auto-cancel runs.
          const rivals = [period, ...otherPeriods].map((p) =>
            world.addRequest({
              equipmentId: equipment['id'],
              teacherId: OTHER_TEACHER.id,
              startDate: p.startDate,
              returnDate: p.endDate,
            }),
          );

          const tx = db.tx;
          if (step === 'request-update') failOn(tx.loanRequest.update, (a) => a.data['status'] === 'APROBADA', step);
          if (step === 'loan-create') failOn(tx.loan.create, () => true, step);
          if (step === 'equipment-update') failOn(tx.equipment.update, () => true, step);
          if (step === 'history-approved') failOn(tx.historyEvent.create, (a) => a.data['eventType'] === 'REQUEST_APPROVED', step);
          if (step === 'history-loan-started') failOn(tx.historyEvent.create, (a) => a.data['eventType'] === 'LOAN_STARTED', step);
          if (step === 'auto-cancel') failOn(tx.loanRequest.update, (a) => a.data['status'] === 'CANCELADA', step);

          const outcome = await settle(loanRequestsService.approveLoanRequest(idOf(target), ADMIN.id));

          const approved = target['status'] === 'APROBADA';
          const loanCreated = world.loans.some(
            (l) => l['requestId'] === target['id'] && l['status'] === 'ACTIVO',
          );
          const lent = equipment['status'] === 'PRESTADO';
          const recorded =
            world.events.some((e) => e['eventType'] === 'REQUEST_APPROVED' && e['requestId'] === target['id']) &&
            world.events.some((e) => e['eventType'] === 'LOAN_STARTED' && e['requestId'] === target['id']);

          if (step === 'none') {
            expect(outcome.ok).toBe(true);
            expect([approved, loanCreated, lent, recorded]).toEqual([true, true, true, true]);
          } else {
            expect(outcome.ok).toBe(false);
            expect(String((outcome as { error: Error }).error.message)).toContain(step);
            // None of the four happened — and nothing else leaked either.
            expect([approved, loanCreated, lent, recorded]).toEqual([false, false, false, false]);
            expect(world.loans).toHaveLength(0);
            expect(world.events).toHaveLength(0);
            expect(rivals.every((r) => r['status'] === 'PENDIENTE')).toBe(true);
            expect(pdfService.generateVoucher).not.toHaveBeenCalled();
          }
          // Every write went through the transaction client.
          expect(rootWriteCount()).toBe(0);
        },
      ),
      { numRuns: 140 },
    );
  });

  it('Feature: equipment-loan-management, Property 13: Validación y registro del rechazo de solicitud', async () => {
    const reasonArb = fc
      .oneof(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 488, max: 512 }),
        fc.integer({ min: 0, max: 600 }),
      )
      .chain((length) => fc.string({ unit: 'grapheme-ascii', minLength: length, maxLength: length }));

    await fc.assert(
      fc.asyncProperty(reasonArb, async (reason) => {
        resetPrismaMock(db);
        const world = new World(db);
        const equipment = world.addEquipment();
        const target = world.addRequest({ equipmentId: equipment['id'] });
        const snapshot = { ...target };

        const res = await request(server)
          .post(`/api/v1/loan-requests/${idOf(target)}/reject`)
          .set('Authorization', bearer(ADMIN))
          .send({ rejectionReason: reason });

        const entered = reason.trim();
        if (entered.length >= 10 && entered.length <= 500) {
          expect(res.status).toBe(200);
          expect(target['status']).toBe('RECHAZADA');
          expect(target['rejectionReason']).toBe(entered);
          expect(res.body.data.rejectionReason).toBe(entered);
          expect(world.events).toHaveLength(1);
          expect(world.events[0]).toMatchObject({ eventType: 'REQUEST_REJECTED', userId: ADMIN.id });
          expect(world.events[0]!['changedFields']).toContainEqual({
            field: 'rejectionReason',
            before: null,
            after: entered,
          });
        } else {
          expect(res.status).toBe(400);
          expect(res.body.error.message).toBe('El motivo de rechazo debe tener entre 10 y 500 caracteres');
          expect({ ...target }).toEqual(snapshot);
          expect(writeCallCount(db)).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Feature: equipment-loan-management, Property 14: Auto-cancelación de solicitudes conflictivas al aprobar un préstamo', async () => {
    const otherSpecArb = fc.record({
      period: periodArb({ minStart: 0, maxStart: 30, maxLength: 10 }),
      onTarget: fc.boolean(),
      status: fc.constantFrom('PENDIENTE', 'PENDIENTE', 'RECHAZADA', 'CANCELADA'),
      owner: fc.constantFrom(TEACHER.id, OTHER_TEACHER.id),
    });

    await fc.assert(
      fc.asyncProperty(
        periodArb({ minStart: 0, maxStart: 30, maxLength: 10 }),
        fc.array(otherSpecArb, { maxLength: 10 }),
        async (approvedPeriod, specs) => {
          resetPrismaMock(db);
          const world = new World(db);
          const target = world.addEquipment();
          const elsewhere = world.addEquipment();
          const approvedRequest = world.addRequest({
            equipmentId: target['id'],
            startDate: approvedPeriod.startDate,
            returnDate: approvedPeriod.endDate,
          });
          const others = specs.map((spec) => ({
            spec,
            row: world.addRequest({
              equipmentId: (spec.onTarget ? target : elsewhere)['id'],
              teacherId: spec.owner,
              status: spec.status,
              startDate: spec.period.startDate,
              returnDate: spec.period.endDate,
            }),
          }));

          const result = await loanRequestsService.approveLoanRequest(idOf(approvedRequest), ADMIN.id);

          const shouldCancel = (spec: { period: Period; onTarget: boolean; status: string }) =>
            spec.onTarget && spec.status === 'PENDIENTE' && overlaps(spec.period, approvedPeriod);

          const expectedIds = others.filter(({ spec }) => shouldCancel(spec)).map(({ row }) => idOf(row));
          expect(result.autoCancelledRequestIds.slice().sort()).toEqual(expectedIds.slice().sort());

          for (const { spec, row } of others) {
            if (shouldCancel(spec)) {
              expect(row['status']).toBe('CANCELADA');
              expect(row['cancelledAt']).toBeInstanceOf(Date);
              const entries = world.events.filter(
                (e) => e['eventType'] === 'REQUEST_CANCELLED' && e['entityId'] === row['id'],
              );
              expect(entries).toHaveLength(1);
              expect(entries[0]!['userId']).toBe(ADMIN.id);
            } else {
              expect(row['status']).toBe(spec.status);
              expect(row['cancelledAt']).toBeNull();
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
