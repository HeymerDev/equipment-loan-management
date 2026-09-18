// Task 10.3 — property tests for the loan voucher (Properties 15, 25 and 26).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { pdfService } from '../../src/modules/pdf/pdf.service.js';
import { PdfGenerationError } from '../../src/shared/errors.js';
import { resetPrismaMock, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, OTHER_TEACHER, bearer } from '../helpers/auth.js';
import { World, utcDay } from '../helpers/world.js';
import { periodArb } from '../helpers/arbitraries.js';
import {
  formatDateTimeUtc,
  formatDay,
  normalizeText,
  pageCount,
  pdfText,
  wordsArb,
} from '../helpers/pdf.js';

const db = prisma as unknown as PrismaMock;
const idOf = (row: Row): string => row['id'] as string;
const DAY_MS = 86_400_000;

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
  vi.restoreAllMocks();
});

async function atInstant<T>(instant: Date, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

const SECTIONS = ['DATOS DE LA INSTITUCIÓN', 'DATOS DEL EQUIPO', 'DATOS DEL DOCENTE', 'DATOS DEL PRÉSTAMO'];

describe('voucher properties', () => {
  it('Feature: equipment-loan-management, Property 15: Resiliencia del estado del préstamo ante fallo de PDF', async () => {
    type Failure = 'pdf-error' | 'unexpected-error' | 'delayed-rejection' | 'non-error-throw';

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Failure>('pdf-error', 'unexpected-error', 'delayed-rejection', 'non-error-throw'),
        periodArb({ minStart: 0, maxStart: 30 }),
        fc.array(periodArb({ minStart: 0, maxStart: 40 }), { maxLength: 3 }),
        async (failure, period, rivalPeriods) => {
          resetPrismaMock(db);
          const world = new World(db);
          const equipment = world.addEquipment();
          const target = world.addRequest({
            equipmentId: equipment['id'],
            startDate: period.startDate,
            returnDate: period.endDate,
          });
          for (const rival of rivalPeriods) {
            world.addRequest({ equipmentId: equipment['id'], teacherId: OTHER_TEACHER.id, startDate: rival.startDate, returnDate: rival.endDate });
          }

          // Capture the committed state at the moment the voucher fails.
          let stateAtFailure: unknown;
          const snapshot = () =>
            JSON.stringify({
              requests: world.requests.map((r) => [r['id'], r['status'], r['cancelledAt']]),
              loans: world.loans.map((l) => [l['id'], l['status'], l['agreedReturnDate'], l['actualReturnDate']]),
              equipment: [equipment['status'], equipment['deletedAt']],
              events: world.events.length,
            });

          vi.spyOn(pdfService, 'generateVoucher').mockImplementation(async () => {
            stateAtFailure = snapshot();
            if (failure === 'pdf-error') throw new PdfGenerationError();
            if (failure === 'unexpected-error') throw new TypeError('Cannot read properties of undefined');
            if (failure === 'delayed-rejection') {
              await new Promise((resolve) => setTimeout(resolve, 2));
              throw new Error('timeout');
            }
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'boom';
          });

          const res = await request(server)
            .post(`/api/v1/loan-requests/${idOf(target)}/approve`)
            .set('Authorization', bearer(ADMIN));

          expect(res.status).toBe(207);
          expect(res.body.data.pdfGenerated).toBe(false);
          expect(res.body.data).not.toHaveProperty('pdfUrl');
          expect(typeof res.body.warning).toBe('string');

          expect(target['status']).toBe('APROBADA');
          expect(world.loans).toHaveLength(1);
          expect(world.loans[0]!['status']).toBe('ACTIVO');
          expect(equipment['status']).toBe('PRESTADO');
          // Nothing changed after the failure.
          expect(snapshot()).toBe(stateAtFailure);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 25: Contenido completo del comprobante PDF', async () => {
    const loanArb = fc.record({
      equipmentName: wordsArb(100),
      serialNumber: fc.stringMatching(/^[A-Z0-9-]{1,50}$/),
      teacherName: wordsArb(80),
      purpose: wordsArb(500),
      startOffset: fc.integer({ min: -200, max: 200 }),
      length: fc.integer({ min: 1, max: 60 }),
      finished: fc.boolean(),
      returnNotes: fc.option(wordsArb(500), { nil: null }),
      generatedAt: fc.date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2040-12-31T23:59:00Z'), noInvalidDate: true }),
    });

    await fc.assert(
      fc.asyncProperty(loanArb, async (spec) => {
        resetPrismaMock(db);
        const world = new World(db);
        const teacherId = randomUUID();
        world.users.push({ id: teacherId, email: 'docente.pdf@test.local', fullName: spec.teacherName, role: 'DOCENTE' });

        const startDate = utcDay(spec.startOffset, spec.generatedAt);
        const agreedReturnDate = utcDay(spec.startOffset + spec.length, spec.generatedAt);
        const actualReturnDate = new Date(agreedReturnDate.getTime() + 5 * 3_600_000);
        const { loan } = world.addActiveLoan(
          { startDate, agreedReturnDate },
          {
            equipment: { name: spec.equipmentName, serialNumber: spec.serialNumber },
            request: { teacherId, purpose: spec.purpose },
            loan: spec.finished
              ? { status: 'FINALIZADO', actualReturnDate, returnedLate: false, daysLate: 0, returnNotes: spec.returnNotes }
              : {},
          },
        );

        const pdf = await atInstant(spec.generatedAt, () => pdfService.generateVoucher(idOf(loan)));
        const text = normalizeText(pdfText(pdf));

        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        // The longest purpose plus the longest notes may carry the signatures
        // over to a second page (checked in pdf.service.test.ts).
        expect(pageCount(pdf)).toBeLessThanOrEqual(2);
        expect(text).toContain('Firma del administrador');
        expect(text).toContain('Firma del docente');
        for (const section of SECTIONS) expect(text).toContain(section);
        expect(text).toContain('Institución Colegio de Pruebas');
        expect(text).toContain(`Equipo ${normalizeText(spec.equipmentName)}`);
        expect(text).toContain(`Número de serie ${spec.serialNumber}`);
        expect(text).toContain(`Nombre completo ${normalizeText(spec.teacherName)}`);
        expect(text).toContain(`Propósito ${normalizeText(spec.purpose)}`);
        expect(text).toContain(`Fecha de inicio ${formatDay(startDate)}`);
        expect(text).toContain(`Devolución pactada ${formatDay(agreedReturnDate)}`);
        expect(text).toContain(`Fecha de generación ${formatDateTimeUtc(spec.generatedAt)}`);
        expect(text).toMatch(/Fecha de generación \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
        expect(text).toContain(`Estado ${spec.finished ? 'Finalizado' : 'Activo'}`);
        if (spec.finished) {
          expect(text).toContain(`Devolución real ${formatDateTimeUtc(actualReturnDate)}`);
          if (spec.returnNotes !== null) expect(text).toContain(`Observaciones ${normalizeText(spec.returnNotes)}`);
        } else {
          expect(text).not.toContain('Devolución real');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 26: Regeneración del PDF con datos vigentes', async () => {
    const MUTATIONS = ['equipmentName', 'serialNumber', 'teacherName', 'purpose', 'agreedReturnDate', 'returned'] as const;
    type Mutation = (typeof MUTATIONS)[number];
    const tokenArb = fc.stringMatching(/^[A-F0-9]{10}$/);

    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...MUTATIONS], { minLength: 1 }),
        tokenArb,
        tokenArb,
        fc.integer({ min: 6, max: 40 }),
        async (mutations: Mutation[], oldToken, newToken, newAgreedOffset) => {
          resetPrismaMock(db);
          const world = new World(db);
          const base = new Date('2026-03-01T00:00:00Z');
          const generatedAt = new Date('2040-01-01T10:00:00Z');
          const teacherId = randomUUID();
          world.users.push({ id: teacherId, email: 'regen@test.local', fullName: `Docente VIEJO${oldToken}`, role: 'DOCENTE' });
          const { loan, equipment, request: loanRequest } = world.addActiveLoan(
            { startDate: base, agreedReturnDate: utcDay(5, base) },
            {
              equipment: { name: `Equipo VIEJO${oldToken}`, serialNumber: `SN-VIEJO${oldToken}` },
              request: { teacherId, purpose: `Propósito VIEJO${oldToken}` },
            },
          );
          const teacher = world.users.find((u) => u['id'] === teacherId)!;

          const original = normalizeText(pdfText(await atInstant(generatedAt, () => pdfService.generateVoucher(idOf(loan)))));
          expect(original).toContain(`VIEJO${oldToken}`);

          const oldAgreed = formatDay(loan['agreedReturnDate'] as Date);
          const newAgreedDate = utcDay(newAgreedOffset, base);
          for (const mutation of mutations) {
            if (mutation === 'equipmentName') equipment['name'] = `Equipo NUEVO${newToken}`;
            if (mutation === 'serialNumber') equipment['serialNumber'] = `SN-NUEVO${newToken}`;
            if (mutation === 'teacherName') teacher['fullName'] = `Docente NUEVO${newToken}`;
            if (mutation === 'purpose') loanRequest['purpose'] = `Propósito NUEVO${newToken}`;
            if (mutation === 'agreedReturnDate') loan['agreedReturnDate'] = newAgreedDate;
            if (mutation === 'returned') {
              loan['status'] = 'FINALIZADO';
              loan['actualReturnDate'] = new Date(base.getTime() + 2 * DAY_MS);
              loan['returnNotes'] = `Nota NUEVO${newToken}`;
            }
          }

          const regenerated = normalizeText(pdfText(await atInstant(generatedAt, () => pdfService.generateVoucher(idOf(loan)))));

          const expectChange = (label: string, before: string, after: string) => {
            expect(regenerated).toContain(`${label} ${after}`);
            expect(regenerated).not.toContain(`${label} ${before}`);
          };
          if (mutations.includes('equipmentName')) expectChange('Equipo', `Equipo VIEJO${oldToken}`, `Equipo NUEVO${newToken}`);
          if (mutations.includes('serialNumber')) expectChange('Número de serie', `SN-VIEJO${oldToken}`, `SN-NUEVO${newToken}`);
          if (mutations.includes('teacherName')) expectChange('Nombre completo', `Docente VIEJO${oldToken}`, `Docente NUEVO${newToken}`);
          if (mutations.includes('purpose')) expectChange('Propósito', `Propósito VIEJO${oldToken}`, `Propósito NUEVO${newToken}`);
          if (mutations.includes('agreedReturnDate')) expectChange('Devolución pactada', oldAgreed, formatDay(newAgreedDate));
          if (mutations.includes('returned')) {
            expectChange('Estado', 'Activo', 'Finalizado');
            expect(regenerated).toContain('Devolución real');
            expect(regenerated).toContain(`Observaciones Nota NUEVO${newToken}`);
          }
          // Untouched fields keep their value.
          if (!mutations.includes('equipmentName')) expect(regenerated).toContain(`Equipo Equipo VIEJO${oldToken}`);
          if (!mutations.includes('teacherName')) expect(regenerated).toContain(`Nombre completo Docente VIEJO${oldToken}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});
