import PDFDocument from 'pdfkit';
import type { LoanStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import {
  AppError,
  NotFoundError,
  PdfGenerationError,
} from '../../shared/errors.js';

const voucherSelect = {
  id: true,
  status: true,
  startDate: true,
  agreedReturnDate: true,
  actualReturnDate: true,
  returnedLate: true,
  daysLate: true,
  returnNotes: true,
  equipment: {
    select: {
      name: true,
      serialNumber: true,
      category: { select: { name: true } },
    },
  },
  request: {
    select: {
      purpose: true,
      teacher: { select: { fullName: true, email: true } },
    },
  },
} satisfies Prisma.LoanSelect;

type VoucherLoan = Prisma.LoanGetPayload<{ select: typeof voucherSelect }>;

// ── Formatting ────────────────────────────────────────────────────────────────

const pad = (value: number): string => String(value).padStart(2, '0');

/** Loan dates are calendar days stored at UTC midnight: DD/MM/YYYY. */
function formatDay(date: Date): string {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** An exact instant in the institution's timezone: DD/MM/YYYY HH:MM (Req 6.1). */
function formatDateTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts['day']}/${parts['month']}/${parts['year']} ${parts['hour']}:${parts['minute']}`;
}

const STATUS_LABEL: Record<LoanStatus, string> = {
  ACTIVO: 'Activo',
  FINALIZADO: 'Finalizado',
};

// ── Layout ────────────────────────────────────────────────────────────────────

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LABEL_WIDTH = 140;
const INSET = 10;

// Dark ink and a single accent: the voucher is meant to be printed, often in
// grayscale, so contrast carries the structure rather than colour.
const INK = '#111827';
const MUTED = '#4b5563';
const ACCENT = '#1e3a8a';
const BAND = '#e5e7eb';
const RULE = '#9ca3af';

type Doc = PDFKit.PDFDocument;

/** Section band: a tinted bar with the title, delimiting each data area (Req 6.4). */
function drawSection(doc: Doc, title: string): void {
  doc.moveDown(0.8);
  const top = doc.y;

  doc.rect(MARGIN, top, CONTENT_WIDTH, 22).fill(BAND);
  doc.rect(MARGIN, top, 3, 22).fill(ACCENT);
  doc
    .fillColor(ACCENT)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(title.toUpperCase(), MARGIN + INSET + 3, top + 7, {
      width: CONTENT_WIDTH - INSET * 2,
      characterSpacing: 0.6,
      lineBreak: false,
    });

  doc.x = MARGIN;
  doc.y = top + 32;
}

/** A label/value row; the value wraps inside its column (purpose, notes). */
function drawField(doc: Doc, label: string, value: string): void {
  const top = doc.y;
  const valueX = MARGIN + INSET + LABEL_WIDTH;

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9.5)
    .text(label, MARGIN + INSET, top + 1, { width: LABEL_WIDTH - 10 });
  const labelBottom = doc.y;

  doc
    .fillColor(INK)
    .font('Helvetica')
    .fontSize(11)
    .text(value, valueX, top, { width: CONTENT_WIDTH - INSET * 2 - LABEL_WIDTH });

  doc.x = MARGIN;
  doc.y = Math.max(doc.y, labelBottom) + 6;
}

function drawVoucher(doc: Doc, loan: VoucherLoan, generatedAt: Date): void {
  const folio = loan.id.slice(0, 8).toUpperCase();

  // ── Title block ─────────────────────────────────────────────────────────────
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Comprobante de préstamo de equipo', MARGIN, MARGIN, {
      width: CONTENT_WIDTH,
    });
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(10)
    .text(`Folio ${folio}`, { width: CONTENT_WIDTH });
  doc.moveDown(0.4);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
    .lineWidth(1)
    .strokeColor(INK)
    .stroke();

  // ── Sections ────────────────────────────────────────────────────────────────
  drawSection(doc, 'Datos de la institución');
  drawField(doc, 'Institución', env.INSTITUTION_NAME);

  drawSection(doc, 'Datos del equipo');
  drawField(doc, 'Equipo', loan.equipment.name);
  drawField(doc, 'Número de serie', loan.equipment.serialNumber);
  drawField(doc, 'Categoría', loan.equipment.category.name);

  drawSection(doc, 'Datos del docente');
  drawField(doc, 'Nombre completo', loan.request.teacher.fullName);
  drawField(doc, 'Correo electrónico', loan.request.teacher.email);

  drawSection(doc, 'Datos del préstamo');
  drawField(doc, 'Propósito', loan.request.purpose);
  drawField(doc, 'Fecha de inicio', formatDay(loan.startDate));
  drawField(doc, 'Devolución pactada', formatDay(loan.agreedReturnDate));
  drawField(doc, 'Estado', STATUS_LABEL[loan.status]);

  // A regenerated voucher reflects the loan as it stands now (Req 6.5).
  if (loan.actualReturnDate !== null) {
    drawField(doc, 'Devolución real', formatDateTime(loan.actualReturnDate));
    if (loan.returnedLate === true && loan.daysLate !== null) {
      drawField(
        doc,
        'Retraso',
        `${loan.daysLate} ${loan.daysLate === 1 ? 'día' : 'días'}`,
      );
    }
  }
  if (loan.returnNotes !== null) {
    drawField(doc, 'Observaciones', loan.returnNotes);
  }
  drawField(doc, 'Fecha de generación', formatDateTime(generatedAt));

  // ── Signatures ──────────────────────────────────────────────────────────────
  const pageBottom = doc.page.height - MARGIN;
  const lineWidth = (CONTENT_WIDTH - 60) / 2;
  let lineY: number;

  // Lines, captions and footer need about 110pt below the content.
  if (doc.y + 110 > pageBottom) {
    // Carry the signatures to a new page that names the voucher it belongs
    // to, rather than leaving them alone at the bottom of an empty sheet.
    doc.addPage();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`Comprobante de préstamo de equipo · Folio ${folio} (continuación)`, MARGIN, MARGIN, {
        width: CONTENT_WIDTH,
      });
    lineY = doc.y + 70;
  } else {
    lineY = Math.max(doc.y + 70, pageBottom - 90);
  }
  const signers: Array<[number, string]> = [
    [MARGIN, 'Firma del administrador'],
    [MARGIN + lineWidth + 60, 'Firma del docente'],
  ];

  for (const [x, caption] of signers) {
    doc
      .moveTo(x, lineY)
      .lineTo(x + lineWidth, lineY)
      .lineWidth(0.75)
      .strokeColor(RULE)
      .stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(caption, x, lineY + 6, { width: lineWidth, align: 'center' });
  }

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(7.5)
    .text(`Identificador del préstamo: ${loan.id}`, MARGIN, pageBottom - 12, {
      width: CONTENT_WIDTH,
      align: 'center',
      lineBreak: false,
    });
}

function renderVoucher(loan: VoucherLoan, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Only the standard PDF fonts are used, so nothing is fetched at runtime
    // (Req 6.4).
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `Comprobante de préstamo ${loan.id}`,
        Author: env.INSTITUTION_NAME,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawVoucher(doc, loan, generatedAt);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export class PdfService {
  /**
   * Builds the loan voucher from the loan's current data (Req 6.1, 6.5). The
   * PDF is rendered on every call rather than stored, so it can never go stale.
   *
   * A missing loan surfaces as a 404; anything else that goes wrong is logged
   * and reported as a controlled `PdfGenerationError`. Generation only reads,
   * so a failure never changes the loan (Req 6.3).
   */
  async generateVoucher(
    loanId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Buffer> {
    const client = tx ?? prisma;

    try {
      const loan = await client.loan.findUnique({
        where: { id: loanId },
        select: voucherSelect,
      });

      if (!loan) throw new NotFoundError('Préstamo');

      return await renderVoucher(loan, new Date());
    } catch (err) {
      if (err instanceof AppError) throw err;

      console.error(`[PDF] Voucher generation failed for loan ${loanId}`, err);
      throw new PdfGenerationError();
    }
  }
}

export const pdfService = new PdfService();
