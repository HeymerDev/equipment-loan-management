// Task 8.3 — property tests for loans and returns (Properties 16–19).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { loansService } from '../../src/modules/loans/loans.service.js';
import { listLoansQuerySchema } from '../../src/modules/loans/loans.schema.js';
import { ConflictError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';

const db = prisma as unknown as PrismaMock;
const DAY_MS = 86_400_000;
const WRITE_METHODS = ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];
const idOf = (row: Row): string => row['id'] as string;

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

/** Freezes only `Date`, leaving real timers for supertest and promises. */
async function atInstant<T>(instant: Date, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

const instantArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2035-12-31T23:59:59Z'),
  noInvalidDate: true,
});

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
afterEach(() => {
  vi.useRealTimers();
});

describe('loan properties', () => {
  it('Feature: equipment-loan-management, Property 16: Atomicidad del registro de devolución', async () => {
    type Step = 'none' | 'loan-update' | 'equipment-update' | 'history';

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Step>('none', 'loan-update', 'equipment-update', 'history'),
        fc.integer({ min: -30, max: 30 }),
        fc.option(fc.string({ unit: 'grapheme-ascii', maxLength: 500 }), { nil: undefined }),
        async (step, agreedOffset, returnNotes) => {
          resetPrismaMock(db);
          const world = new World(db);
          const { equipment, loan } = world.addActiveLoan({
            startDate: utcDay(agreedOffset - 3),
            agreedReturnDate: utcDay(agreedOffset),
          });
          const loanBefore = { ...loan };
          const equipmentBefore = { ...equipment };

          const failing: Record<Exclude<Step, 'none'>, Mock> = {
            'loan-update': db.tx.loan.update,
            'equipment-update': db.tx.equipment.update,
            history: db.tx.historyEvent.create,
          };
          if (step !== 'none') {
            failing[step].mockRejectedValue(new Error(`injected failure at ${step}`));
          }

          const outcome = await loansService.returnLoan(idOf(loan), { returnNotes }, ADMIN.id).then(
            () => true,
            () => false,
          );

          if (step === 'none') {
            expect(outcome).toBe(true);
            expect(loan['status']).toBe('FINALIZADO');
            expect(loan['actualReturnDate']).toBeInstanceOf(Date);
            expect(equipment['status']).toBe('DISPONIBLE');
            const returned = world.events.filter((e) => e['eventType'] === 'LOAN_RETURNED');
            expect(returned).toHaveLength(1);
            expect(returned[0]).toMatchObject({ loanId: loan['id'], equipmentId: equipment['id'] });
            expect(returned[0]!['changedFields']).toContainEqual({
              field: 'actualReturnDate',
              before: null,
              after: (loan['actualReturnDate'] as Date).toISOString(),
            });
          } else {
            expect(outcome).toBe(false);
            expect({ ...loan }).toEqual(loanBefore);
            expect({ ...equipment }).toEqual(equipmentBefore);
            expect(world.events).toHaveLength(0);
          }
          expect(rootWriteCount()).toBe(0);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('Feature: equipment-loan-management, Property 17: Detección y registro de devolución con retraso', async () => {
    // Loans are settled by calendar day (see loans.service.ts): the formula
    // ceil(actualReturnDate - agreedReturnDate) is applied to the UTC day of
    // each date, so returning at any hour of the agreed day is on time.
    await fc.assert(
      fc.asyncProperty(instantArb, fc.integer({ min: -90, max: 30 }), async (now, agreedOffset) => {
        resetPrismaMock(db);
        const world = new World(db);
        const agreed = utcDay(agreedOffset, now);
        const { loan } = world.addActiveLoan({
          startDate: utcDay(agreedOffset - 5, now),
          agreedReturnDate: agreed,
        });

        const result = await atInstant(now, () => loansService.returnLoan(idOf(loan), {}, ADMIN.id));

        const expectedDays = Math.max(0, Math.ceil((utcDay(0, now).getTime() - agreed.getTime()) / DAY_MS));
        expect(result.actualReturnDate).toBe(now.toISOString());
        expect(result.returnedLate).toBe(expectedDays > 0);
        expect(result.daysLate).toBe(expectedDays);

        const changes = world.events[0]!['changedFields'] as Array<{ field: string; after: unknown }>;
        expect(changes).toContainEqual({ field: 'returnedLate', before: null, after: expectedDays > 0 });
        if (expectedDays > 0) {
          expect(changes).toContainEqual({ field: 'daysLate', before: null, after: expectedDays });
        } else {
          expect(changes.some((change) => change.field === 'daysLate')).toBe(false);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('Feature: equipment-loan-management, Property 18: Rechazo de devolución sobre préstamos no activos', async () => {
    const finishedArb = fc.record({
      agreedOffset: fc.integer({ min: -60, max: 0 }),
      returnedHoursAfter: fc.integer({ min: -48, max: 24 * 30 }),
      returnedLate: fc.boolean(),
      daysLate: fc.integer({ min: 0, max: 30 }),
      returnNotes: fc.option(fc.string({ unit: 'grapheme-ascii', maxLength: 500 }), { nil: null }),
    });

    await fc.assert(
      fc.asyncProperty(finishedArb, fc.boolean(), async (spec, overHttp) => {
        resetPrismaMock(db);
        const world = new World(db);
        const agreedReturnDate = utcDay(spec.agreedOffset);
        const { equipment, loan } = world.addActiveLoan(
          { startDate: utcDay(spec.agreedOffset - 4), agreedReturnDate },
          {
            equipment: { status: 'DISPONIBLE' },
            loan: {
              status: 'FINALIZADO',
              actualReturnDate: new Date(agreedReturnDate.getTime() + spec.returnedHoursAfter * 3_600_000),
              returnedLate: spec.returnedLate,
              daysLate: spec.daysLate,
              returnNotes: spec.returnNotes,
            },
          },
        );
        const loanBefore = { ...loan };
        const equipmentBefore = { ...equipment };

        if (overHttp) {
          const res = await request(server)
            .post(`/api/v1/loans/${idOf(loan)}/return`)
            .set('Authorization', bearer(ADMIN))
            .send({ returnNotes: 'Segundo intento de devolución' });
          expect(res.status).toBe(409);
          expect(res.body.error.message).toBe('El préstamo no está activo y no admite registro de devolución');
        } else {
          const error = await loansService.returnLoan(idOf(loan), {}, ADMIN.id).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(ConflictError);
        }

        expect({ ...loan }).toEqual(loanBefore);
        expect({ ...equipment }).toEqual(equipmentBefore);
        expect(world.events).toHaveLength(0);
        expect(writeCallCount(db)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 19: Indicador de vencimiento correcto en préstamos activos', async () => {
    // Day-level reading of "agreedReturnDate is before now": a loan becomes
    // overdue once its agreed UTC day is behind the current UTC day.
    const scenarioArb = instantArb.chain((now) =>
      fc.tuple(
        fc.constant(now),
        fc.array(
          fc.record({
            agreedReturnDate: fc.oneof(
              fc.integer({ min: -40, max: 40 }).map((days) => utcDay(days, now)),
              fc.integer({ min: -40 * DAY_MS, max: 40 * DAY_MS }).map((ms) => new Date(now.getTime() + ms)),
            ),
            status: fc.constantFrom('ACTIVO', 'FINALIZADO'),
          }),
          { minLength: 1, maxLength: 25 },
        ),
      ),
    );

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ([now, specs]) => {
        resetPrismaMock(db);
        const world = new World(db);
        for (const spec of specs) {
          world.addActiveLoan(
            { startDate: new Date(spec.agreedReturnDate.getTime() - 3 * DAY_MS), agreedReturnDate: spec.agreedReturnDate },
            { loan: { status: spec.status } },
          );
        }
        const today = utcDay(0, now);
        const oracle = (loan: Row) =>
          loan['status'] === 'ACTIVO' && (loan['agreedReturnDate'] as Date) < today;

        await atInstant(now, async () => {
          for (const status of ['ACTIVO', 'FINALIZADO'] as const) {
            const listed = await loansService.listActiveLoans(listLoansQuerySchema.parse({ status, limit: 100 }));
            for (const dto of listed.data) {
              const stored = world.loans.find((l) => l['id'] === dto.id)!;
              expect(dto.isOverdue).toBe(oracle(stored));
            }
          }
          for (const loan of world.loans) {
            const detail = await loansService.getLoanById(idOf(loan), { id: ADMIN.id, role: 'ADMINISTRADOR' });
            expect(detail.isOverdue).toBe(oracle(loan));
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
