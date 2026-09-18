// Task 6.4 — unit tests for LoanRequestsService and its HTTP contract.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/modules/pdf/pdf.service.js', () => ({
  pdfService: { generateVoucher: vi.fn() },
}));

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import { pdfService } from '../../src/modules/pdf/pdf.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, OTHER_TEACHER, TEACHER, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';

const db = prisma as unknown as PrismaMock;
const idOf = (row: Row): string => row['id'] as string;
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
  vi.mocked(pdfService.generateVoucher).mockReset().mockResolvedValue(Buffer.from('%PDF-'));
  world = new World(db);
});

function input(equipment: Row, from: number, to: number, purpose = 'Feria de ciencias') {
  return { equipmentId: idOf(equipment), purpose, startDate: utcDay(from), returnDate: utcDay(to) };
}

describe('createLoanRequest (Req 2.1–2.5)', () => {
  it('creates a PENDIENTE request and records REQUEST_CREATED by the teacher', async () => {
    const equipment = world.addEquipment({ name: 'Proyector' });

    const created = await loanRequestsService.createLoanRequest(input(equipment, 1, 3), TEACHER.id);

    expect(created).toMatchObject({
      status: 'PENDIENTE',
      teacherId: TEACHER.id,
      teacherName: 'Docente de Prueba',
      equipmentName: 'Proyector',
    });
    expect(world.events).toEqual([
      expect.objectContaining({
        eventType: 'REQUEST_CREATED',
        entityId: created.id,
        entityTable: 'LoanRequest',
        userId: TEACHER.id,
        equipmentId: equipment['id'],
        requestId: created.id,
      }),
    ]);
  });

  it('normalises both dates to the start of their UTC day', async () => {
    const equipment = world.addEquipment();
    const startDate = new Date(utcDay(5).getTime() + 15.5 * 3_600_000);
    const returnDate = new Date(utcDay(7).getTime() + 23 * 3_600_000);

    const created = await loanRequestsService.createLoanRequest(
      { equipmentId: idOf(equipment), purpose: 'Clase', startDate, returnDate },
      TEACHER.id,
    );

    expect(created.startDate).toBe(utcDay(5).toISOString());
    expect(created.returnDate).toBe(utcDay(7).toISOString());
  });

  it('accepts a request that starts today', async () => {
    const equipment = world.addEquipment();

    await expect(
      loanRequestsService.createLoanRequest(input(equipment, 0, 1), TEACHER.id),
    ).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it.each([
    ['equal to', 2, 2],
    ['before', 4, 2],
  ])('rejects a return date %s the start date with a descriptive message', async (_label, from, to) => {
    const equipment = world.addEquipment();

    const error = await loanRequestsService
      .createLoanRequest(input(equipment, from, to), TEACHER.id)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      field: 'returnDate',
      message: 'La fecha de devolución debe ser posterior a la fecha de inicio',
    });
    expect(writeCallCount(db)).toBe(0);
  });

  it('rejects a start date in the past', async () => {
    const equipment = world.addEquipment();

    const error = await loanRequestsService
      .createLoanRequest(input(equipment, -1, 3), TEACHER.id)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      field: 'startDate',
      message: 'La fecha de inicio no puede ser en el pasado',
    });
  });

  it('rejects a period overlapping an active loan on the same equipment', async () => {
    const { equipment } = world.addActiveLoan({ startDate: utcDay(0), agreedReturnDate: utcDay(4) });

    const error = await loanRequestsService
      .createLoanRequest(input(equipment, 3, 6), TEACHER.id)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe('El equipo no está disponible en el período solicitado');
    expect(writeCallCount(db)).toBe(0);
  });

  it('counts sharing only the boundary day as an overlap (days are inclusive)', async () => {
    const { equipment } = world.addActiveLoan({ startDate: utcDay(0), agreedReturnDate: utcDay(4) });

    await expect(
      loanRequestsService.createLoanRequest(input(equipment, 4, 6), TEACHER.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      loanRequestsService.createLoanRequest(input(equipment, 5, 6), TEACHER.id),
    ).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it('is not blocked by finished loans, loans of other equipment, or other pending requests', async () => {
    const equipment = world.addEquipment();
    const finished = world.addActiveLoan(
      { startDate: utcDay(0), agreedReturnDate: utcDay(5) },
      { loan: { status: 'FINALIZADO' } },
    );
    finished.loan['equipmentId'] = equipment['id'];
    world.addActiveLoan({ startDate: utcDay(0), agreedReturnDate: utcDay(5) });
    world.addRequest({ equipmentId: equipment['id'], teacherId: OTHER_TEACHER.id, startDate: utcDay(1), returnDate: utcDay(3) });

    await expect(
      loanRequestsService.createLoanRequest(input(equipment, 1, 3), TEACHER.id),
    ).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it('answers 404 for unknown or soft-deleted equipment', async () => {
    const removed = world.addEquipment({ deletedAt: new Date() });

    await expect(
      loanRequestsService.createLoanRequest(input(removed, 1, 2), TEACHER.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      loanRequestsService.createLoanRequest(
        { ...input(removed, 1, 2), equipmentId: 'e0000000-0000-4000-8000-0000000000ff' },
        TEACHER.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('POST /loan-requests — body validation (Req 2.1)', () => {
  const post = (body: object) =>
    request(server).post('/api/v1/loan-requests').set('Authorization', bearer(TEACHER)).send(body);

  function body(equipment: Row, overrides: Record<string, unknown> = {}) {
    return {
      equipmentId: equipment['id'],
      purpose: 'Clase de robótica',
      startDate: utcDay(1).toISOString().slice(0, 10),
      returnDate: utcDay(3).toISOString().slice(0, 10),
      ...overrides,
    };
  }

  it.each(['equipmentId', 'purpose', 'startDate', 'returnDate'])(
    'rejects a request without %s and names the field',
    async (field) => {
      const payload: Record<string, unknown> = body(world.addEquipment());
      delete payload[field];

      const res = await post(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.field).toBe(field);
      expect(writeCallCount(db)).toBe(0);
    },
  );

  it('accepts a purpose of exactly 500 characters and rejects 501', async () => {
    const equipment = world.addEquipment();

    expect((await post(body(equipment, { purpose: 'p'.repeat(500) }))).status).toBe(201);
    const tooLong = await post(body(equipment, { purpose: 'p'.repeat(501) }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatchObject({
      field: 'purpose',
      message: 'El propósito no puede exceder 500 caracteres',
    });
  });

  it('rejects a date that cannot be parsed', async () => {
    const res = await post(body(world.addEquipment(), { startDate: 'mañana' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      field: 'startDate',
      message: 'La fecha de inicio no es una fecha válida',
    });
  });

  it('is reserved to teachers', async () => {
    const res = await request(server)
      .post('/api/v1/loan-requests')
      .set('Authorization', bearer(ADMIN))
      .send(body(world.addEquipment()));

    expect(res.status).toBe(403);
  });
});

describe('approveLoanRequest (Req 3.2, 3.5–3.7)', () => {
  const approve = (target: Row) =>
    request(server)
      .post(`/api/v1/loan-requests/${idOf(target)}/approve`)
      .set('Authorization', bearer(ADMIN));

  it('approves: request APROBADA, ACTIVO loan with the requested dates, equipment PRESTADO, two entries', async () => {
    const equipment = world.addEquipment();
    const target = world.addRequest({ equipmentId: equipment['id'], startDate: utcDay(2), returnDate: utcDay(6) });

    const res = await approve(target);

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
    const loan = world.loans[0]!;
    expect(res.body.data).toMatchObject({
      request: { status: 'APROBADA' },
      loan: {
        id: loan['id'],
        status: 'ACTIVO',
        startDate: utcDay(2).toISOString(),
        agreedReturnDate: utcDay(6).toISOString(),
      },
      pdfGenerated: true,
      pdfUrl: `/api/v1/loans/${String(loan['id'])}/pdf`,
      autoCancelledRequestIds: [],
    });
    expect(equipment['status']).toBe('PRESTADO');
    expect(world.events.map((e) => e['eventType'])).toEqual(['REQUEST_APPROVED', 'LOAN_STARTED']);
    expect(world.events[1]).toMatchObject({ entityId: loan['id'], entityTable: 'Loan', loanId: loan['id'] });
    expect(pdfService.generateVoucher).toHaveBeenCalledWith(loan['id']);
  });

  it('cancels the overlapping pending requests and reports them', async () => {
    const equipment = world.addEquipment();
    const target = world.addRequest({ equipmentId: equipment['id'], startDate: utcDay(2), returnDate: utcDay(6) });
    const clash = world.addRequest({ equipmentId: equipment['id'], teacherId: OTHER_TEACHER.id, startDate: utcDay(5), returnDate: utcDay(9) });
    const later = world.addRequest({ equipmentId: equipment['id'], teacherId: OTHER_TEACHER.id, startDate: utcDay(7), returnDate: utcDay(9) });

    const result = await loanRequestsService.approveLoanRequest(idOf(target), ADMIN.id);

    expect(result.autoCancelledRequestIds).toEqual([clash['id']]);
    expect(clash['status']).toBe('CANCELADA');
    expect(later['status']).toBe('PENDIENTE');
  });

  it('answers 207 with a warning when the voucher fails, and the loan stands', async () => {
    vi.mocked(pdfService.generateVoucher).mockRejectedValueOnce(new Error('pdfkit exploded'));
    const equipment = world.addEquipment();
    const target = world.addRequest({ equipmentId: equipment['id'] });

    const res = await approve(target);

    expect(res.status).toBe(207);
    expect(res.body.warning).toBe(
      'El comprobante PDF no pudo generarse. El préstamo fue creado correctamente.',
    );
    expect(res.body.data.pdfGenerated).toBe(false);
    expect(res.body.data).not.toHaveProperty('pdfUrl');
    expect(target['status']).toBe('APROBADA');
    expect(world.loans[0]!['status']).toBe('ACTIVO');
  });

  it.each(['APROBADA', 'RECHAZADA', 'CANCELADA'])('refuses a request already %s', async (status) => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'], status });

    const error = await loanRequestsService.approveLoanRequest(idOf(target), ADMIN.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe('Solo se pueden aprobar solicitudes en estado pendiente');
    expect(writeCallCount(db)).toBe(0);
  });

  it('refuses when the equipment already has an active loan', async () => {
    const { equipment } = world.addActiveLoan({ startDate: utcDay(0), agreedReturnDate: utcDay(2) });
    const target = world.addRequest({ equipmentId: equipment['id'], startDate: utcDay(10), returnDate: utcDay(12) });

    const error = await loanRequestsService.approveLoanRequest(idOf(target), ADMIN.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe('El equipo tiene un préstamo activo y no está disponible');
    expect(writeCallCount(db)).toBe(0);
  });

  it('refuses when the equipment was removed from the inventory', async () => {
    const equipment = world.addEquipment({ deletedAt: new Date() });
    const target = world.addRequest({ equipmentId: equipment['id'] });

    await expect(loanRequestsService.approveLoanRequest(idOf(target), ADMIN.id)).rejects.toThrow(
      'El equipo fue eliminado del inventario y no puede prestarse',
    );
  });

  it('answers 404 for an unknown request', async () => {
    const res = await request(server)
      .post('/api/v1/loan-requests/f0000000-0000-4000-8000-0000000000ff/approve')
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(404);
  });
});

describe('rejectLoanRequest (Req 3.3, 3.4)', () => {
  const reject = (target: Row, rejectionReason: unknown) =>
    request(server)
      .post(`/api/v1/loan-requests/${idOf(target)}/reject`)
      .set('Authorization', bearer(ADMIN))
      .send({ rejectionReason });

  it.each([
    [9, 400],
    [10, 200],
    [500, 200],
    [501, 400],
  ])('a reason of %i characters answers %i', async (length, status) => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'] });

    const res = await reject(target, 'r'.repeat(length));

    expect(res.status).toBe(status);
    if (status === 400) {
      expect(res.body.error.message).toBe('El motivo de rechazo debe tener entre 10 y 500 caracteres');
      expect(target['status']).toBe('PENDIENTE');
    } else {
      expect(target['status']).toBe('RECHAZADA');
    }
  });

  it('stores the reason and records it with the status change', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'] });

    await loanRequestsService.rejectLoanRequest(idOf(target), 'Equipo en mantenimiento preventivo', ADMIN.id);

    expect(target).toMatchObject({ status: 'RECHAZADA', rejectionReason: 'Equipo en mantenimiento preventivo' });
    expect(world.events[0]).toMatchObject({ eventType: 'REQUEST_REJECTED', userId: ADMIN.id });
    expect(world.events[0]!['changedFields']).toEqual([
      { field: 'status', before: 'PENDIENTE', after: 'RECHAZADA' },
      { field: 'rejectionReason', before: null, after: 'Equipo en mantenimiento preventivo' },
    ]);
  });

  it('refuses a request that is not pending', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'], status: 'CANCELADA' });

    await expect(
      loanRequestsService.rejectLoanRequest(idOf(target), 'Motivo suficiente', ADMIN.id),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(writeCallCount(db)).toBe(0);
  });
});

describe('cancelLoanRequest (Req 2.7)', () => {
  it('cancels the teacher’s own pending request with its timestamp', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'] });

    const before = Date.now();
    const res = await request(server)
      .patch(`/api/v1/loan-requests/${idOf(target)}/cancel`)
      .set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELADA');
    expect(new Date(res.body.data.cancelledAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(world.events[0]).toMatchObject({ eventType: 'REQUEST_CANCELLED', userId: TEACHER.id });
  });

  it('forbids cancelling another teacher’s request', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'], teacherId: OTHER_TEACHER.id });

    const error = await loanRequestsService.cancelLoanRequest(idOf(target), TEACHER.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).message).toBe('No puede cancelar solicitudes de otro docente');
    expect(target['status']).toBe('PENDIENTE');
  });

  it('refuses to cancel a request that is no longer pending', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'], status: 'APROBADA' });

    await expect(loanRequestsService.cancelLoanRequest(idOf(target), TEACHER.id)).rejects.toThrow(
      'Solo se pueden cancelar solicitudes en estado pendiente',
    );
  });
});

describe('queries (Req 2.8, 3.1)', () => {
  it('lists the pending queue oldest first by default and honours ?status=', async () => {
    const equipment = world.addEquipment();
    const newer = world.addRequest({ equipmentId: equipment['id'], createdAt: new Date('2026-02-02T10:00:00Z') });
    const older = world.addRequest({ equipmentId: equipment['id'], createdAt: new Date('2026-02-01T10:00:00Z') });
    const approved = world.addRequest({ equipmentId: equipment['id'], status: 'APROBADA' });

    const pending = await request(server).get('/api/v1/loan-requests').set('Authorization', bearer(ADMIN));
    const onlyApproved = await request(server)
      .get('/api/v1/loan-requests?status=APROBADA')
      .set('Authorization', bearer(ADMIN));

    expect(pending.body.data.map((r: { id: string }) => r.id)).toEqual([older['id'], newer['id']]);
    expect(pending.body.meta).toEqual({ page: 1, limit: 50, total: 2 });
    expect(onlyApproved.body.data.map((r: { id: string }) => r.id)).toEqual([approved['id']]);
  });

  it('lists only the teacher’s own requests, newest first', async () => {
    const equipment = world.addEquipment();
    const first = world.addRequest({ equipmentId: equipment['id'], createdAt: new Date('2026-02-01T10:00:00Z') });
    const second = world.addRequest({ equipmentId: equipment['id'], createdAt: new Date('2026-02-03T10:00:00Z') });
    world.addRequest({ equipmentId: equipment['id'], teacherId: OTHER_TEACHER.id });

    const res = await request(server).get('/api/v1/loan-requests/my').set('Authorization', bearer(TEACHER));

    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([second['id'], first['id']]);
  });

  it('lets a teacher read only their own request, while an administrator reads any', async () => {
    const target = world.addRequest({ equipmentId: world.addEquipment()['id'], teacherId: OTHER_TEACHER.id });

    await expect(
      loanRequestsService.getLoanRequestById(idOf(target), { id: TEACHER.id, role: 'DOCENTE' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      loanRequestsService.getLoanRequestById(idOf(target), { id: OTHER_TEACHER.id, role: 'DOCENTE' }),
    ).resolves.toMatchObject({ id: target['id'] });
    await expect(
      loanRequestsService.getLoanRequestById(idOf(target), { id: ADMIN.id, role: 'ADMINISTRADOR' }),
    ).resolves.toMatchObject({ id: target['id'] });
  });
});
