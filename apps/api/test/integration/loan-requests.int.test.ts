// Task 6.4 (integration) — loan requests against a real PostgreSQL database,
// including the database-backed half of Property 12 (real rollback).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { app } from '../../src/app.js';
import { equipmentService } from '../../src/modules/equipment/equipment.service.js';
import { loanRequestsService } from '../../src/modules/loan-requests/loan-requests.service.js';
import { ConflictError } from '../../src/shared/errors.js';
import { periodArb } from '../helpers/arbitraries.js';
import { utcDay } from '../helpers/world.js';
import { cleanup, createFixtures, login, serial, type Fixtures } from './db.js';

let fx: Fixtures;

beforeAll(async () => {
  fx = await createFixtures();
});

afterAll(async () => {
  await cleanup();
});

const newEquipment = (label: string) =>
  equipmentService.createEquipment(
    { name: `Equipo ${label}`, serialNumber: serial(label), description: 'Integración', categoryId: fx.category.id },
    fx.admin.id,
  );

const newRequest = (equipmentId: string, from: number, to: number, teacherId = fx.teacher.id) =>
  loanRequestsService.createLoanRequest(
    { equipmentId, purpose: 'Clase de integración', startDate: utcDay(from), returnDate: utcDay(to) },
    teacherId,
  );

describe('loan requests on PostgreSQL', () => {
  it('runs the whole flow over HTTP: request → approve → active loan, lent equipment, history and voucher', async () => {
    const [teacherToken, adminToken] = await Promise.all([login(fx.teacher), login(fx.admin)]);
    const equipment = await newEquipment('FLOW');

    const created = await request(app)
      .post('/api/v1/loan-requests')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        equipmentId: equipment.id,
        purpose: 'Feria de ciencias',
        startDate: utcDay(1).toISOString().slice(0, 10),
        returnDate: utcDay(4).toISOString().slice(0, 10),
      });
    expect(created.status).toBe(201);

    const approved = await request(app)
      .post(`/api/v1/loan-requests/${created.body.data.id as string}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.pdfGenerated).toBe(true);

    const voucher = await request(app).get(approved.body.data.pdfUrl as string).set('Authorization', `Bearer ${adminToken}`);
    expect(voucher.status).toBe(200);
    expect(voucher.headers['content-type']).toBe('application/pdf');

    const loan = await prisma.loan.findUniqueOrThrow({ where: { requestId: created.body.data.id as string } });
    expect(loan.status).toBe('ACTIVO');
    expect((await prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } })).status).toBe('PRESTADO');
    const events = await prisma.historyEvent.findMany({
      where: { requestId: created.body.data.id as string },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => e.eventType).sort()).toEqual(['LOAN_STARTED', 'REQUEST_APPROVED', 'REQUEST_CREATED']);
  });

  it('Feature: equipment-loan-management, Property 12 (PostgreSQL): un fallo dentro de la aprobación revierte las cuatro condiciones', async () => {
    await fc.assert(
      fc.asyncProperty(periodArb({ minStart: 0, maxStart: 20, maxLength: 6 }), async (period) => {
        const equipment = await newEquipment('P12');
        const start = Math.round((period.startDate.getTime() - utcDay(0).getTime()) / 86_400_000);
        const end = Math.round((period.endDate.getTime() - utcDay(0).getTime()) / 86_400_000);
        const target = await newRequest(equipment.id, start, end);
        const rival = await newRequest(equipment.id, start, end, fx.otherTeacher.id);

        // An author that does not exist makes the history insert violate its
        // foreign key *after* the request, loan and equipment writes.
        const ghostAdmin = randomUUID();
        await expect(loanRequestsService.approveLoanRequest(target.id, ghostAdmin)).rejects.toMatchObject({
          code: 'P2003',
        });

        const [storedRequest, storedRival, storedEquipment, loans, events] = await Promise.all([
          prisma.loanRequest.findUniqueOrThrow({ where: { id: target.id } }),
          prisma.loanRequest.findUniqueOrThrow({ where: { id: rival.id } }),
          prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } }),
          prisma.loan.count({ where: { equipmentId: equipment.id } }),
          prisma.historyEvent.findMany({ where: { equipmentId: equipment.id } }),
        ]);
        expect(storedRequest.status).toBe('PENDIENTE');
        expect(storedRival.status).toBe('PENDIENTE');
        expect(storedEquipment.status).toBe('DISPONIBLE');
        expect(loans).toBe(0);
        expect(events.map((e) => e.eventType).sort()).toEqual([
          'EQUIPMENT_CREATED',
          'REQUEST_CREATED',
          'REQUEST_CREATED',
        ]);

        // The same approval by a real administrator then succeeds.
        await loanRequestsService.approveLoanRequest(target.id, fx.admin.id);
        expect((await prisma.loanRequest.findUniqueOrThrow({ where: { id: rival.id } })).status).toBe('CANCELADA');
      }),
      { numRuns: 8 },
    );
  });

  it('detects overlaps on real timestamps, counting the shared boundary day', async () => {
    const equipment = await newEquipment('OVERLAP');
    const holder = await newRequest(equipment.id, 0, 4);
    await loanRequestsService.approveLoanRequest(holder.id, fx.admin.id);

    await expect(newRequest(equipment.id, 4, 6)).rejects.toBeInstanceOf(ConflictError);
    await expect(newRequest(equipment.id, 5, 7)).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it('rejects with a reason and cancels, persisting both in the history', async () => {
    const equipment = await newEquipment('DECIDE');
    const toReject = await newRequest(equipment.id, 1, 2);
    const toCancel = await newRequest(equipment.id, 3, 4);

    await loanRequestsService.rejectLoanRequest(toReject.id, 'Equipo reservado para mantenimiento', fx.admin.id);
    await loanRequestsService.cancelLoanRequest(toCancel.id, fx.teacher.id);

    const rejected = await prisma.loanRequest.findUniqueOrThrow({ where: { id: toReject.id } });
    const cancelled = await prisma.loanRequest.findUniqueOrThrow({ where: { id: toCancel.id } });
    expect(rejected).toMatchObject({ status: 'RECHAZADA', rejectionReason: 'Equipo reservado para mantenimiento' });
    expect(cancelled.status).toBe('CANCELADA');
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);

    const cancelEntry = await prisma.historyEvent.findFirstOrThrow({
      where: { requestId: toCancel.id, eventType: 'REQUEST_CANCELLED' },
    });
    expect(cancelEntry.changedFields).toContainEqual({
      field: 'cancelledAt',
      before: null,
      after: cancelled.cancelledAt!.toISOString(),
    });
  });

  it('orders the teacher’s requests newest first and the pending queue oldest first', async () => {
    const equipment = await newEquipment('ORDER');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await newRequest(equipment.id, 10 + i * 3, 11 + i * 3, fx.otherTeacher.id)).id);

    const mine = await loanRequestsService.listMyRequests(fx.otherTeacher.id, { page: 1, limit: 100 });
    const mineOrder = mine.data.map((r) => r.id).filter((id) => ids.includes(id));
    expect(mineOrder).toEqual([...ids].reverse());

    const pendingIds: string[] = [];
    let previous = '';
    for (let page = 1; ; page++) {
      const result = await loanRequestsService.listPendingRequests({ status: 'PENDIENTE', page, limit: 100 });
      for (const entry of result.data) {
        expect(entry.createdAt >= previous).toBe(true);
        previous = entry.createdAt;
        pendingIds.push(entry.id);
      }
      if (result.data.length < 100) break;
    }
    expect(pendingIds.filter((id) => ids.includes(id))).toEqual(ids);
  });
});
