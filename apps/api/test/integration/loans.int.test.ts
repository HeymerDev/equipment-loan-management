// Task 8.4 (integration) — loans and returns against a real PostgreSQL database,
// including the database-backed half of Property 16 (real rollback).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { app } from '../../src/app.js';
import { equipmentService } from '../../src/modules/equipment/equipment.service.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import { loansService } from '../../src/modules/loans/loans.service.js';
import { historyQueryService } from '../../src/modules/history/history.service.js';
import { ConflictError } from '../../src/shared/errors.js';
import { utcDay } from '../helpers/world.js';
import { normalizeText, pdfText } from '../helpers/pdf.js';
import { cleanup, createFixtures, login, serial, type Fixtures } from './db.js';

let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures();
});

afterAll(async () => {
  await cleanup();
});

async function activeLoan(label: string) {
  const equipment = await equipmentService.createEquipment(
    { name: `Equipo ${label}`, serialNumber: serial(label), description: 'Integración', categoryId: fx.category.id },
    fx.admin.id,
  );
  const pending = await loanRequestsService.createLoanRequest(
    { equipmentId: equipment.id, purpose: 'Préstamo de integración', startDate: utcDay(0), returnDate: utcDay(3) },
    fx.teacher.id,
  );
  const { loan } = await loanRequestsService.approveLoanRequest(pending.id, fx.admin.id);
  return { equipment, loan };
}

describe('loans on PostgreSQL', () => {
  it('closes a loan in one transaction, with the entry timestamped by the database', async () => {
    const { equipment, loan } = await activeLoan('RETURN');

    const before = Date.now();
    await loansService.returnLoan(loan.id, { returnNotes: 'Sin novedades' }, fx.admin.id);
    const after = Date.now();

    const [storedLoan, storedEquipment] = await Promise.all([
      prisma.loan.findUniqueOrThrow({ where: { id: loan.id } }),
      prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } }),
    ]);
    expect(storedLoan).toMatchObject({ status: 'FINALIZADO', returnNotes: 'Sin novedades', returnedLate: false, daysLate: 0 });
    expect(storedEquipment.status).toBe('DISPONIBLE');

    const entries = await historyQueryService.listEvents({ equipmentId: equipment.id, eventType: 'LOAN_RETURNED', page: 1, limit: 100 });
    expect(entries.data).toHaveLength(1);
    const occurredAt = new Date(entries.data[0]!.occurredAt).getTime();
    // Allow for clock drift between this machine and the database server.
    expect(occurredAt).toBeGreaterThan(before - 120_000);
    expect(occurredAt).toBeLessThan(after + 120_000);
    expect(entries.data[0]!.changedFields).toContainEqual({
      field: 'actualReturnDate',
      before: null,
      after: storedLoan.actualReturnDate!.toISOString(),
    });
  });

  it('Feature: equipment-loan-management, Property 16 (PostgreSQL): un fallo dentro de la devolución revierte las tres condiciones', async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(fc.string({ unit: 'grapheme-ascii', maxLength: 200 }), { nil: undefined }), async (returnNotes) => {
        const { equipment, loan } = await activeLoan('P16');

        await expect(loansService.returnLoan(loan.id, { returnNotes }, randomUUID())).rejects.toMatchObject({
          code: 'P2003',
        });

        const [storedLoan, storedEquipment, returned] = await Promise.all([
          prisma.loan.findUniqueOrThrow({ where: { id: loan.id } }),
          prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } }),
          prisma.historyEvent.count({ where: { loanId: loan.id, eventType: 'LOAN_RETURNED' } }),
        ]);
        expect(storedLoan).toMatchObject({ status: 'ACTIVO', actualReturnDate: null, returnNotes: null, returnedLate: null });
        expect(storedEquipment.status).toBe('PRESTADO');
        expect(returned).toBe(0);
      }),
      { numRuns: 6 },
    );
  });

  it('computes lateness from the stored agreed day', async () => {
    const { loan } = await activeLoan('LATE');
    await prisma.loan.update({ where: { id: loan.id }, data: { agreedReturnDate: utcDay(-3) } });

    const result = await loansService.returnLoan(loan.id, {}, fx.admin.id);

    expect(result).toMatchObject({ returnedLate: true, daysLate: 3 });
  });

  it('refuses a second return and leaves the row untouched', async () => {
    const { loan } = await activeLoan('TWICE');
    await loansService.returnLoan(loan.id, {}, fx.admin.id);
    const first = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });

    await expect(loansService.returnLoan(loan.id, { returnNotes: 'otra' }, fx.admin.id)).rejects.toBeInstanceOf(ConflictError);

    expect(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).toEqual(first);
  });

  it('flags overdue loans from real rows', async () => {
    const overdue = await activeLoan('OVERDUE');
    const onTime = await activeLoan('ONTIME');
    await prisma.loan.update({ where: { id: overdue.loan.id }, data: { agreedReturnDate: utcDay(-1) } });

    const admin = { id: fx.admin.id, role: 'ADMINISTRADOR' };
    expect((await loansService.getLoanById(overdue.loan.id, admin)).isOverdue).toBe(true);
    expect((await loansService.getLoanById(onTime.loan.id, admin)).isOverdue).toBe(false);
  });

  it('serves the voucher of a real loan over HTTP', async () => {
    const { equipment, loan } = await activeLoan('VOUCHER');
    const token = await login(fx.admin);

    const res = await request(app)
      .get(`/api/v1/loans/${loan.id}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const text = normalizeText(pdfText(res.body as Buffer));
    expect(text).toContain(`Número de serie ${equipment.serialNumber}`);
    expect(text).toContain('Institución Colegio de Integración');
    expect(text).toContain('Nombre completo Docente de Integración');
  });
});
