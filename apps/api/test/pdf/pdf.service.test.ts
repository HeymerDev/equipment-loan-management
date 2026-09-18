// Task 10.4 — unit tests for PdfService and the voucher endpoint.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Prisma } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { pdfService } from '../../src/modules/pdf/pdf.service.js';
import { NotFoundError, PdfGenerationError } from '../../src/shared/errors.js';
import { resetPrismaMock, writeCallCount, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, TEACHER, bearer } from '../helpers/auth.js';
import { World } from '../helpers/world.js';
import { normalizeText, pageCount, pdfPages, pdfText } from '../helpers/pdf.js';

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
  world = new World(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const GENERATED_AT = new Date('2026-09-14T13:59:00Z');

/** 500 characters of prose built from one repeated word. */
const longText = (word: string): string => `${word} `.repeat(200).slice(0, 500).trim();

function sampleLoan(overrides: { loan?: Row; equipment?: Row; request?: Row } = {}) {
  world.users.find((u) => u['id'] === TEACHER.id)!['fullName'] = 'María Fernanda López';
  return world.addActiveLoan(
    { startDate: new Date('2026-09-15T00:00:00Z'), agreedReturnDate: new Date('2026-09-17T00:00:00Z') },
    {
      equipment: { name: 'Proyector multimedia 3500 lúmenes', serialNumber: 'PX3500-0147', categoryId: world.categories[1]!['id'] },
      request: { purpose: 'Presentación de la feria de ciencias en el auditorio principal' },
      ...overrides,
    },
  );
}

async function render(loan: Row): Promise<{ pdf: Buffer; text: string }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(GENERATED_AT);
  try {
    const pdf = await pdfService.generateVoucher(idOf(loan));
    return { pdf, text: normalizeText(pdfText(pdf)) };
  } finally {
    vi.useRealTimers();
  }
}

describe('PdfService.generateVoucher — content (Req 6.1, 6.4)', () => {
  it('renders the four delimited sections with every required datum', async () => {
    const { loan } = sampleLoan();

    const { pdf, text } = await render(loan);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    for (const fragment of [
      'Comprobante de préstamo de equipo',
      `Folio ${idOf(loan).slice(0, 8).toUpperCase()}`,
      'DATOS DE LA INSTITUCIÓN Institución Colegio de Pruebas',
      'DATOS DEL EQUIPO Equipo Proyector multimedia 3500 lúmenes Número de serie PX3500-0147 Categoría Proyectores',
      'DATOS DEL DOCENTE Nombre completo María Fernanda López Correo electrónico docente@test.local',
      'DATOS DEL PRÉSTAMO Propósito Presentación de la feria de ciencias en el auditorio principal',
      'Fecha de inicio 15/09/2026',
      'Devolución pactada 17/09/2026',
      'Estado Activo',
      'Fecha de generación 14/09/2026 13:59',
      'Firma del administrador',
      'Firma del docente',
      `Identificador del préstamo: ${idOf(loan)}`,
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it('leaves out return details for an active loan', async () => {
    const { loan } = sampleLoan();

    const { text } = await render(loan);

    expect(text).not.toContain('Devolución real');
    expect(text).not.toContain('Retraso');
    expect(text).not.toContain('Observaciones');
  });

  it.each([
    [1, '1 día'],
    [3, '3 días'],
  ])('shows the return of a finished loan %i day(s) late', async (daysLate, label) => {
    const { loan } = sampleLoan({
      loan: {
        status: 'FINALIZADO',
        actualReturnDate: new Date('2026-09-20T16:45:00Z'),
        returnedLate: true,
        daysLate,
        returnNotes: 'Devuelto con el cable HDMI',
      },
    });

    const { text } = await render(loan);

    expect(text).toContain('Estado Finalizado');
    expect(text).toContain('Devolución real 20/09/2026 16:45');
    expect(text).toContain(`Retraso ${label}`);
    expect(text).toContain('Observaciones Devuelto con el cable HDMI');
  });

  it('does not print a delay for a finished loan returned on time', async () => {
    const { loan } = sampleLoan({
      loan: { status: 'FINALIZADO', actualReturnDate: new Date('2026-09-17T09:00:00Z'), returnedLate: false, daysLate: 0 },
    });

    const { text } = await render(loan);

    expect(text).toContain('Devolución real 17/09/2026 09:00');
    expect(text).not.toContain('Retraso');
  });

  it('fits the longest purpose on a single page', async () => {
    const { loan } = sampleLoan({ request: { purpose: longText('laboratorio') } });

    const { pdf, text } = await render(loan);

    expect(pageCount(pdf)).toBe(1);
    expect(text).toContain(`Propósito ${longText('laboratorio')}`);
  });

  it('carries the signatures to a second page that names the voucher when the content does not fit', async () => {
    const { loan } = sampleLoan({
      request: { purpose: longText('laboratorio') },
      loan: {
        status: 'FINALIZADO',
        actualReturnDate: new Date('2026-09-18T10:00:00Z'),
        returnedLate: true,
        daysLate: 1,
        returnNotes: longText('observación'),
      },
    });

    const { pdf } = await render(loan);
    const pages = pdfPages(pdf).map(normalizeText);

    expect(pageCount(pdf)).toBe(2);
    expect(pages).toHaveLength(2);
    // Every datum stays on the first page…
    expect(pages[0]).toContain(`Propósito ${longText('laboratorio')}`);
    expect(pages[0]).toContain(`Observaciones ${longText('observación')}`);
    expect(pages[0]).toContain('Fecha de generación 14/09/2026 13:59');
    expect(pages[0]).not.toContain('Firma del administrador');
    // …and the second page says which voucher it continues.
    expect(pages[1]).toContain(`Folio ${idOf(loan).slice(0, 8).toUpperCase()} (continuación)`);
    expect(pages[1]).toContain('Firma del administrador');
    expect(pages[1]).toContain('Firma del docente');
    expect(pages[1]).toContain(`Identificador del préstamo: ${idOf(loan)}`);
  });

  it('reflects the data current at regeneration time (Req 6.5)', async () => {
    const { loan, equipment } = sampleLoan();
    const first = await render(loan);

    equipment['name'] = 'Proyector Epson renombrado';
    loan['agreedReturnDate'] = new Date('2026-09-19T00:00:00Z');
    const second = await render(loan);

    expect(first.text).toContain('Equipo Proyector multimedia 3500 lúmenes');
    expect(second.text).toContain('Equipo Proyector Epson renombrado');
    expect(second.text).not.toContain('Proyector multimedia 3500 lúmenes');
    expect(second.text).toContain('Devolución pactada 19/09/2026');
  });

  it('only reads: generating never writes', async () => {
    const { loan } = sampleLoan();

    await render(loan);

    expect(writeCallCount(db)).toBe(0);
  });
});

describe('PdfService.generateVoucher — errors (Req 6.3)', () => {
  it('reads through the transaction client when one is given', async () => {
    const { loan } = sampleLoan();

    await pdfService.generateVoucher(idOf(loan), db.tx as unknown as Prisma.TransactionClient);

    expect(db.tx.loan.findUnique).toHaveBeenCalledTimes(1);
    expect(db.loan.findUnique).not.toHaveBeenCalled();
  });

  it('reports a missing loan as NotFoundError, not as a generation failure', async () => {
    await expect(
      pdfService.generateVoucher('10000000-0000-4000-8000-0000000000ff'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('wraps an unexpected failure in PdfGenerationError and logs the cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('connection lost');
    db.loan.findUnique.mockRejectedValue(cause);

    const error = await pdfService.generateVoucher('10000000-0000-4000-8000-000000000001').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PdfGenerationError);
    expect(error).toMatchObject({ statusCode: 500, code: 'PDF_GENERATION_FAILED', message: 'El comprobante PDF no pudo generarse' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('10000000-0000-4000-8000-000000000001'), cause);
  });
});

describe('GET /loans/:id/pdf (Req 6.2, 6.3)', () => {
  it('serves the voucher inline and uncached to administrators', async () => {
    const { loan } = sampleLoan();

    const res = await request(server)
      .get(`/api/v1/loans/${idOf(loan)}/pdf`)
      .set('Authorization', bearer(ADMIN))
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`inline; filename="comprobante-prestamo-${idOf(loan)}.pdf"`);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as Buffer;
    expect(Number(res.headers['content-length'])).toBe(body.length);
    expect(normalizeText(pdfText(body))).toContain('Número de serie PX3500-0147');
  });

  it('answers 404 for an unknown loan, 400 for a malformed id and 403 for teachers', async () => {
    const { loan } = sampleLoan();

    const unknown = await request(server).get('/api/v1/loans/10000000-0000-4000-8000-0000000000ff/pdf').set('Authorization', bearer(ADMIN));
    const malformed = await request(server).get('/api/v1/loans/abc/pdf').set('Authorization', bearer(ADMIN));
    const teacher = await request(server).get(`/api/v1/loans/${idOf(loan)}/pdf`).set('Authorization', bearer(TEACHER));

    expect([unknown.status, malformed.status, teacher.status]).toEqual([404, 400, 403]);
  });

  it('answers a structured error when generation fails, and the loan is untouched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loan } = sampleLoan();
    const before = { ...loan };
    db.loan.findUnique.mockRejectedValue(new Error('disk full'));

    const res = await request(server).get(`/api/v1/loans/${idOf(loan)}/pdf`).set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'PDF_GENERATION_FAILED', message: 'El comprobante PDF no pudo generarse' } });
    expect({ ...loan }).toEqual(before);
  });
});

describe('approval with a failing voucher (Req 3.7)', () => {
  it('answers 207 and keeps the request APROBADA and the loan ACTIVO', async () => {
    vi.spyOn(pdfService, 'generateVoucher').mockRejectedValue(new PdfGenerationError());
    const equipment = world.addEquipment();
    const pending = world.addRequest({ equipmentId: equipment['id'] });

    const res = await request(server)
      .post(`/api/v1/loan-requests/${idOf(pending)}/approve`)
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(207);
    expect(res.body.warning).toBe('El comprobante PDF no pudo generarse. El préstamo fue creado correctamente.');
    expect(pending['status']).toBe('APROBADA');
    expect(world.loans[0]!['status']).toBe('ACTIVO');
    expect(equipment['status']).toBe('PRESTADO');
  });
});
