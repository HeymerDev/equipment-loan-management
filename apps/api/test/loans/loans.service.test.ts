// Task 8.4 — unit tests for LoansService and its HTTP contract.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { loansService } from '../../src/modules/loans/loans.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, OTHER_TEACHER, TEACHER, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';

const db = prisma as unknown as PrismaMock;
const idOf = (row: Row): string => row['id'] as string;
const HOUR_MS = 3_600_000;
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
afterEach(() => {
  vi.useRealTimers();
});

function freezeAt(instant: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
}

const AGREED = new Date('2026-05-10T00:00:00Z');

describe('returnLoan (Req 4.1–4.4)', () => {
  it('closes an active loan: FINALIZADO, exact instant, equipment DISPONIBLE, LOAN_RETURNED entry', async () => {
    const { equipment, loan, request: loanRequest } = world.addActiveLoan({
      startDate: utcDay(-2),
      agreedReturnDate: utcDay(3),
    });

    const before = Date.now();
    const result = await loansService.returnLoan(idOf(loan), {}, ADMIN.id);

    expect(result).toMatchObject({ status: 'FINALIZADO', returnedLate: false, daysLate: 0, isOverdue: false });
    expect(new Date(result.actualReturnDate!).getTime()).toBeGreaterThanOrEqual(before);
    expect(equipment['status']).toBe('DISPONIBLE');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(world.events).toEqual([
      expect.objectContaining({
        eventType: 'LOAN_RETURNED',
        entityId: loan['id'],
        entityTable: 'Loan',
        userId: ADMIN.id,
        equipmentId: equipment['id'],
        requestId: loanRequest['id'],
        loanId: loan['id'],
      }),
    ]);
    expect(world.events[0]!['changedFields']).toEqual([
      { field: 'status', before: 'ACTIVO', after: 'FINALIZADO' },
      { field: 'actualReturnDate', before: null, after: result.actualReturnDate },
      { field: 'returnedLate', before: null, after: false },
    ]);
  });

  it('stores optional notes and records them', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-2), agreedReturnDate: utcDay(3) });

    const result = await loansService.returnLoan(idOf(loan), { returnNotes: 'Pantalla con un rayón' }, ADMIN.id);

    expect(result.returnNotes).toBe('Pantalla con un rayón');
    expect(world.events[0]!['changedFields']).toContainEqual({
      field: 'returnNotes',
      before: null,
      after: 'Pantalla con un rayón',
    });
  });

  it('counts three days late when returned three days after the agreed day', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-5, AGREED), agreedReturnDate: AGREED });
    freezeAt(new Date(AGREED.getTime() + 3 * 24 * HOUR_MS + 9 * HOUR_MS));

    const result = await loansService.returnLoan(idOf(loan), {}, ADMIN.id);

    expect(result).toMatchObject({ returnedLate: true, daysLate: 3 });
    expect(world.events[0]!['changedFields']).toContainEqual({ field: 'daysLate', before: null, after: 3 });
  });

  it('is on time when returned on the agreed day, even at 23:59', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-5, AGREED), agreedReturnDate: AGREED });
    freezeAt(new Date(AGREED.getTime() + 23 * HOUR_MS + 59 * 60_000));

    const result = await loansService.returnLoan(idOf(loan), {}, ADMIN.id);

    expect(result).toMatchObject({ returnedLate: false, daysLate: 0 });
  });

  it('is one day late one minute after the agreed day ends', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-5, AGREED), agreedReturnDate: AGREED });
    freezeAt(new Date(AGREED.getTime() + 24 * HOUR_MS + 60_000));

    const result = await loansService.returnLoan(idOf(loan), {}, ADMIN.id);

    expect(result).toMatchObject({ returnedLate: true, daysLate: 1 });
  });

  it('never reports negative lateness for an early return', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-5, AGREED), agreedReturnDate: AGREED });
    freezeAt(new Date(AGREED.getTime() - 4 * 24 * HOUR_MS));

    const result = await loansService.returnLoan(idOf(loan), {}, ADMIN.id);

    expect(result).toMatchObject({ returnedLate: false, daysLate: 0 });
  });

  it('refuses to return a finished loan and changes nothing', async () => {
    const { loan, equipment } = world.addActiveLoan(
      { startDate: utcDay(-5), agreedReturnDate: utcDay(-1) },
      { loan: { status: 'FINALIZADO', actualReturnDate: utcDay(-1) }, equipment: { status: 'DISPONIBLE' } },
    );

    const error = await loansService.returnLoan(idOf(loan), { returnNotes: 'otra vez' }, ADMIN.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe('El préstamo no está activo y no admite registro de devolución');
    expect(loan['returnNotes']).toBeNull();
    expect(equipment['status']).toBe('DISPONIBLE');
    expect(writeCallCount(db)).toBe(0);
  });

  it('answers 404 for an unknown loan', async () => {
    await expect(
      loansService.returnLoan('10000000-0000-4000-8000-0000000000ff', {}, ADMIN.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('POST /loans/:id/return over HTTP (Req 4.2)', () => {
  const returnLoan = (loan: Row, body?: object) => {
    const req = request(server).post(`/api/v1/loans/${idOf(loan)}/return`).set('Authorization', bearer(ADMIN));
    return body === undefined ? req : req.send(body);
  };

  it('accepts notes of exactly 500 characters', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(2) });

    const res = await returnLoan(loan, { returnNotes: 'n'.repeat(500) });

    expect(res.status).toBe(200);
    expect(res.body.data.returnNotes).toHaveLength(500);
  });

  it('rejects notes of 501 characters and leaves the loan active', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(2) });

    const res = await returnLoan(loan, { returnNotes: 'n'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      field: 'returnNotes',
      message: 'Las observaciones no pueden exceder 500 caracteres',
    });
    expect(loan['status']).toBe('ACTIVO');
    expect(writeCallCount(db)).toBe(0);
  });

  it('works without a body — notes are optional', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(2) });

    const res = await returnLoan(loan);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('returnNotes');
  });

  it('is reserved to administrators', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(2) });

    const res = await request(server)
      .post(`/api/v1/loans/${idOf(loan)}/return`)
      .set('Authorization', bearer(TEACHER))
      .send({});

    expect(res.status).toBe(403);
    expect(loan['status']).toBe('ACTIVO');
  });
});

describe('listActiveLoans (Req 4.5)', () => {
  it('lists only active loans, soonest due first, with teacher, equipment and both dates', async () => {
    const later = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(9) }, { equipment: { name: 'Tablet', serialNumber: 'TB-1' } });
    const sooner = world.addActiveLoan({ startDate: utcDay(-3), agreedReturnDate: utcDay(1) });
    world.addActiveLoan({ startDate: utcDay(-9), agreedReturnDate: utcDay(-5) }, { loan: { status: 'FINALIZADO' } });

    const res = await request(server).get('/api/v1/loans').set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual([sooner.loan['id'], later.loan['id']]);
    expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 2 });
    expect(res.body.data[1]).toMatchObject({
      teacherId: TEACHER.id,
      teacherName: 'Docente de Prueba',
      equipmentName: 'Tablet',
      equipmentSerialNumber: 'TB-1',
      startDate: utcDay(-1).toISOString(),
      agreedReturnDate: utcDay(9).toISOString(),
      isOverdue: false,
    });
  });

  it('flags as overdue only the loans whose agreed day has passed', async () => {
    const now = new Date('2026-05-10T14:30:00Z');
    const past = world.addActiveLoan({ startDate: utcDay(-6, now), agreedReturnDate: utcDay(-1, now) });
    const today = world.addActiveLoan({ startDate: utcDay(-6, now), agreedReturnDate: utcDay(0, now) });
    const future = world.addActiveLoan({ startDate: utcDay(-6, now), agreedReturnDate: utcDay(1, now) });
    freezeAt(now);

    const result = await loansService.listActiveLoans({ status: 'ACTIVO', page: 1, limit: 50 });

    const flags = Object.fromEntries(result.data.map((l) => [l.id, l.isOverdue]));
    expect(flags).toEqual({ [idOf(past.loan)]: true, [idOf(today.loan)]: false, [idOf(future.loan)]: false });
  });

  it('lists finished loans with ?status=FINALIZADO and never flags them as overdue', async () => {
    const finished = world.addActiveLoan(
      { startDate: utcDay(-20), agreedReturnDate: utcDay(-10) },
      { loan: { status: 'FINALIZADO', actualReturnDate: utcDay(-8), returnedLate: true, daysLate: 2 } },
    );

    const res = await request(server).get('/api/v1/loans?status=FINALIZADO').set('Authorization', bearer(ADMIN));

    expect(res.body.data).toEqual([
      expect.objectContaining({ id: finished.loan['id'], isOverdue: false, returnedLate: true, daysLate: 2 }),
    ]);
  });

  it('rejects pages larger than 100 and is closed to teachers', async () => {
    const tooBig = await request(server).get('/api/v1/loans?limit=101').set('Authorization', bearer(ADMIN));
    const asTeacher = await request(server).get('/api/v1/loans').set('Authorization', bearer(TEACHER));

    expect(tooBig.status).toBe(400);
    expect(asTeacher.status).toBe(403);
  });
});

describe('getLoanById', () => {
  it('lets a teacher read their own loan, not another teacher’s; administrators read any', async () => {
    const { loan } = world.addActiveLoan({ startDate: utcDay(-1), agreedReturnDate: utcDay(2) });

    await expect(loansService.getLoanById(idOf(loan), { id: TEACHER.id, role: 'DOCENTE' })).resolves.toMatchObject({
      id: loan['id'],
    });
    await expect(
      loansService.getLoanById(idOf(loan), { id: OTHER_TEACHER.id, role: 'DOCENTE' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      loansService.getLoanById(idOf(loan), { id: ADMIN.id, role: 'ADMINISTRADOR' }),
    ).resolves.toMatchObject({ id: loan['id'] });
  });

  it('answers 404 for an unknown loan', async () => {
    const res = await request(server)
      .get('/api/v1/loans/10000000-0000-4000-8000-0000000000ff')
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(404);
  });
});
