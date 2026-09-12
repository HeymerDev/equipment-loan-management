import {
  Prisma,
  Role,
  EquipmentStatus,
  LoanStatus,
  LoanRequestStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { historyService } from '../../shared/history.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.js';
import type {
  CreateLoanRequestInput,
  ListLoanRequestsQuery,
  MyLoanRequestsQuery,
} from './loan-requests.schema.js';

/** Public representation of a loan request. */
export interface LoanRequestDto {
  id: string;
  status: LoanRequestStatus;
  purpose: string;
  startDate: string; // ISO 8601
  returnDate: string; // ISO 8601
  rejectionReason?: string;
  cancelledAt?: string; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  teacherId: string;
  teacherName: string;
  equipmentId: string;
  equipmentName: string;
}

/** The loan created by an approval, as returned by the approve endpoint. */
export interface ApprovedLoanDto {
  id: string;
  status: LoanStatus;
  startDate: string; // ISO 8601
  agreedReturnDate: string; // ISO 8601
  equipmentId: string;
  requestId: string;
}

export interface ApproveResult {
  request: LoanRequestDto;
  loan: ApprovedLoanDto;
  /** Requests auto-cancelled because they overlapped the new loan (Req 3.5). */
  autoCancelledRequestIds: string[];
  /** False when the voucher could not be produced — the loan stands either way (Req 3.7). */
  pdfGenerated: boolean;
  /** Present only when the voucher was generated. */
  pdfUrl?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** Actor performing a read, used to scope what a teacher may see. */
export interface RequestActor {
  id: string;
  role: string;
}

const ENTITY_TABLE = 'LoanRequest';
const LOAN_ENTITY_TABLE = 'Loan';

const requestSelect = {
  id: true,
  status: true,
  purpose: true,
  startDate: true,
  returnDate: true,
  rejectionReason: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  teacherId: true,
  equipmentId: true,
  teacher: { select: { fullName: true } },
  equipment: { select: { name: true } },
} satisfies Prisma.LoanRequestSelect;

type RequestRow = Prisma.LoanRequestGetPayload<{ select: typeof requestSelect }>;

function toDto(row: RequestRow): LoanRequestDto {
  return {
    id: row.id,
    status: row.status,
    purpose: row.purpose,
    startDate: row.startDate.toISOString(),
    returnDate: row.returnDate.toISOString(),
    ...(row.rejectionReason !== null && { rejectionReason: row.rejectionReason }),
    ...(row.cancelledAt !== null && { cancelledAt: row.cancelledAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    teacherId: row.teacherId,
    teacherName: row.teacher.fullName,
    equipmentId: row.equipmentId,
    equipmentName: row.equipment.name,
  };
}

/**
 * Collapses a timestamp to the start of its UTC calendar day. Requests are
 * booked by day, so normalising both ends keeps comparisons — and the overlap
 * test — free of time-of-day noise.
 */
function toDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function todayStart(): Date {
  return toDayStart(new Date());
}

export class LoanRequestsService {
  /**
   * Creates a PENDIENTE request after validating the period (Req 2.2, 2.3, 2.4)
   * and confirming the equipment is free for those days (Req 2.5).
   */
  async createLoanRequest(
    input: CreateLoanRequestInput,
    teacherId: string,
  ): Promise<LoanRequestDto> {
    const equipment = await prisma.equipment.findFirst({
      where: { id: input.equipmentId, deletedAt: null },
      select: { id: true },
    });

    if (!equipment) throw new NotFoundError('Equipo');

    const startDate = toDayStart(input.startDate);
    const returnDate = toDayStart(input.returnDate);

    if (returnDate <= startDate) {
      throw new ValidationError(
        'La fecha de devolución debe ser posterior a la fecha de inicio',
        'returnDate',
      );
    }

    if (startDate < todayStart()) {
      throw new ValidationError(
        'La fecha de inicio no puede ser en el pasado',
        'startDate',
      );
    }

    await this.assertEquipmentFreeInPeriod(equipment.id, startDate, returnDate);

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.loanRequest.create({
        data: {
          status: LoanRequestStatus.PENDIENTE,
          purpose: input.purpose,
          startDate,
          returnDate,
          teacherId,
          equipmentId: equipment.id,
        },
        select: requestSelect,
      });

      await historyService.record({
        eventType: 'REQUEST_CREATED',
        entityId: request.id,
        entityTable: ENTITY_TABLE,
        userId: teacherId,
        equipmentId: equipment.id,
        requestId: request.id,
        tx,
      });

      return request;
    });

    return toDto(created);
  }

  /** The admin queue: pending first-come-first-served, oldest first (Req 3.1). */
  async listPendingRequests(
    query: ListLoanRequestsQuery,
  ): Promise<PaginatedResult<LoanRequestDto>> {
    const { page, limit, status } = query;
    const where: Prisma.LoanRequestWhereInput = { status };

    const [rows, total] = await prisma.$transaction([
      prisma.loanRequest.findMany({
        where,
        select: requestSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.loanRequest.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: { page, limit, total } };
  }

  /** The teacher's own requests, newest first (Req 2.8). */
  async listMyRequests(
    teacherId: string,
    query: MyLoanRequestsQuery,
  ): Promise<PaginatedResult<LoanRequestDto>> {
    const { page, limit, status } = query;
    const where: Prisma.LoanRequestWhereInput = {
      teacherId,
      ...(status !== undefined && { status }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.loanRequest.findMany({
        where,
        select: requestSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.loanRequest.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: { page, limit, total } };
  }

  /** Detail of a request. A teacher may only read their own (Req 7.6). */
  async getLoanRequestById(
    id: string,
    actor: RequestActor,
  ): Promise<LoanRequestDto> {
    const request = await prisma.loanRequest.findUnique({
      where: { id },
      select: requestSelect,
    });

    if (!request) throw new NotFoundError('Solicitud');

    if (actor.role !== Role.ADMINISTRADOR && request.teacherId !== actor.id) {
      throw new ForbiddenError('No tiene permisos para ver esta solicitud');
    }

    return toDto(request);
  }

  /** Cancels the teacher's own pending request (Req 2.7). */
  async cancelLoanRequest(
    id: string,
    teacherId: string,
  ): Promise<LoanRequestDto> {
    const request = await prisma.loanRequest.findUnique({
      where: { id },
      select: { id: true, status: true, teacherId: true, equipmentId: true },
    });

    if (!request) throw new NotFoundError('Solicitud');

    if (request.teacherId !== teacherId) {
      throw new ForbiddenError('No puede cancelar solicitudes de otro docente');
    }

    if (request.status !== LoanRequestStatus.PENDIENTE) {
      throw new ConflictError(
        'Solo se pueden cancelar solicitudes en estado pendiente',
      );
    }

    const cancelledAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.loanRequest.update({
        where: { id },
        data: { status: LoanRequestStatus.CANCELADA, cancelledAt },
        select: requestSelect,
      });

      await historyService.record({
        eventType: 'REQUEST_CANCELLED',
        entityId: id,
        entityTable: ENTITY_TABLE,
        userId: teacherId,
        equipmentId: request.equipmentId,
        requestId: id,
        changedFields: [
          {
            field: 'status',
            before: LoanRequestStatus.PENDIENTE,
            after: LoanRequestStatus.CANCELADA,
          },
          { field: 'cancelledAt', before: null, after: cancelledAt.toISOString() },
        ],
        tx,
      });

      return cancelled;
    });

    return toDto(updated);
  }

  /**
   * Approves a request: the status change, the new loan, the equipment status
   * and both history entries all commit together or not at all (Req 3.2,
   * Property 12). Overlapping pending requests are cancelled in the same
   * transaction (Req 3.5). The voucher is attempted afterwards and can never
   * undo any of it (Req 3.7, Property 15).
   */
  async approveLoanRequest(id: string, adminId: string): Promise<ApproveResult> {
    const request = await prisma.loanRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startDate: true,
        returnDate: true,
        equipmentId: true,
        equipment: { select: { id: true, deletedAt: true } },
      },
    });

    if (!request) throw new NotFoundError('Solicitud');

    if (request.status !== LoanRequestStatus.PENDIENTE) {
      throw new ConflictError(
        'Solo se pueden aprobar solicitudes en estado pendiente',
      );
    }

    if (request.equipment.deletedAt !== null) {
      throw new ConflictError(
        'El equipo fue eliminado del inventario y no puede prestarse',
      );
    }

    // Equipment already out on loan cannot take another one (Req 1.4, Property 4).
    const activeLoan = await prisma.loan.findFirst({
      where: { equipmentId: request.equipmentId, status: LoanStatus.ACTIVO },
      select: { id: true },
    });

    if (activeLoan) {
      throw new ConflictError(
        'El equipo tiene un préstamo activo y no está disponible',
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const approved = await tx.loanRequest.update({
          where: { id },
          data: { status: LoanRequestStatus.APROBADA },
          select: requestSelect,
        });

        const loan = await tx.loan.create({
          data: {
            status: LoanStatus.ACTIVO,
            startDate: request.startDate,
            agreedReturnDate: request.returnDate,
            requestId: id,
            equipmentId: request.equipmentId,
          },
          select: {
            id: true,
            status: true,
            startDate: true,
            agreedReturnDate: true,
            equipmentId: true,
            requestId: true,
          },
        });

        await tx.equipment.update({
          where: { id: request.equipmentId },
          data: { status: EquipmentStatus.PRESTADO },
        });

        await historyService.record({
          eventType: 'REQUEST_APPROVED',
          entityId: id,
          entityTable: ENTITY_TABLE,
          userId: adminId,
          equipmentId: request.equipmentId,
          requestId: id,
          loanId: loan.id,
          changedFields: [
            {
              field: 'status',
              before: LoanRequestStatus.PENDIENTE,
              after: LoanRequestStatus.APROBADA,
            },
          ],
          tx,
        });

        await historyService.record({
          eventType: 'LOAN_STARTED',
          entityId: loan.id,
          entityTable: LOAN_ENTITY_TABLE,
          userId: adminId,
          equipmentId: request.equipmentId,
          requestId: id,
          loanId: loan.id,
          tx,
        });

        const autoCancelledRequestIds = await this.autoCancelConflicting(tx, {
          equipmentId: request.equipmentId,
          approvedRequestId: id,
          startDate: request.startDate,
          returnDate: request.returnDate,
          adminId,
        });

        return { approved, loan, autoCancelledRequestIds };
      },
      // Several round trips against a remote database; the default 5 s is tight.
      { timeout: 15_000 },
    );

    const pdfGenerated = await this.tryGenerateVoucher(result.loan.id);

    return {
      request: toDto(result.approved),
      loan: {
        id: result.loan.id,
        status: result.loan.status,
        startDate: result.loan.startDate.toISOString(),
        agreedReturnDate: result.loan.agreedReturnDate.toISOString(),
        equipmentId: result.loan.equipmentId,
        requestId: result.loan.requestId,
      },
      autoCancelledRequestIds: result.autoCancelledRequestIds,
      pdfGenerated,
      ...(pdfGenerated && { pdfUrl: `/api/v1/loans/${result.loan.id}/pdf` }),
    };
  }

  /** Rejects a pending request, recording the reason in the history (Req 3.3). */
  async rejectLoanRequest(
    id: string,
    rejectionReason: string,
    adminId: string,
  ): Promise<LoanRequestDto> {
    const request = await prisma.loanRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        equipmentId: true,
        rejectionReason: true,
      },
    });

    if (!request) throw new NotFoundError('Solicitud');

    if (request.status !== LoanRequestStatus.PENDIENTE) {
      throw new ConflictError(
        'Solo se pueden rechazar solicitudes en estado pendiente',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const rejected = await tx.loanRequest.update({
        where: { id },
        data: { status: LoanRequestStatus.RECHAZADA, rejectionReason },
        select: requestSelect,
      });

      await historyService.record({
        eventType: 'REQUEST_REJECTED',
        entityId: id,
        entityTable: ENTITY_TABLE,
        userId: adminId,
        equipmentId: request.equipmentId,
        requestId: id,
        changedFields: [
          {
            field: 'status',
            before: LoanRequestStatus.PENDIENTE,
            after: LoanRequestStatus.RECHAZADA,
          },
          {
            field: 'rejectionReason',
            before: request.rejectionReason,
            after: rejectionReason,
          },
        ],
        tx,
      });

      return rejected;
    });

    return toDto(updated);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Rejects the period when it overlaps an active loan on the same equipment.
   * Two ranges overlap when each one starts on or before the other one ends.
   */
  private async assertEquipmentFreeInPeriod(
    equipmentId: string,
    startDate: Date,
    returnDate: Date,
  ): Promise<void> {
    const conflict = await prisma.loan.findFirst({
      where: {
        equipmentId,
        status: LoanStatus.ACTIVO,
        startDate: { lte: returnDate },
        agreedReturnDate: { gte: startDate },
      },
      select: { id: true },
    });

    if (conflict) {
      throw new ConflictError(
        'El equipo no está disponible en el período solicitado',
      );
    }
  }

  /**
   * Cancels the pending requests whose period overlaps the loan just created.
   * Teachers learn about it from the status on their requests list, which the
   * web app polls (Req 3.5).
   */
  private async autoCancelConflicting(
    tx: Prisma.TransactionClient,
    params: {
      equipmentId: string;
      approvedRequestId: string;
      startDate: Date;
      returnDate: Date;
      adminId: string;
    },
  ): Promise<string[]> {
    const conflicting = await tx.loanRequest.findMany({
      where: {
        equipmentId: params.equipmentId,
        status: LoanRequestStatus.PENDIENTE,
        id: { not: params.approvedRequestId },
        startDate: { lte: params.returnDate },
        returnDate: { gte: params.startDate },
      },
      select: { id: true },
    });

    const cancelledAt = new Date();

    for (const { id } of conflicting) {
      await tx.loanRequest.update({
        where: { id },
        data: { status: LoanRequestStatus.CANCELADA, cancelledAt },
      });

      await historyService.record({
        eventType: 'REQUEST_CANCELLED',
        entityId: id,
        entityTable: ENTITY_TABLE,
        userId: params.adminId,
        equipmentId: params.equipmentId,
        requestId: id,
        changedFields: [
          {
            field: 'status',
            before: LoanRequestStatus.PENDIENTE,
            after: LoanRequestStatus.CANCELADA,
          },
          { field: 'cancelledAt', before: null, after: cancelledAt.toISOString() },
        ],
        tx,
      });
    }

    return conflicting.map((request) => request.id);
  }

  /**
   * Voucher generation seam. Task 10.1 implements `PDFService.generateVoucher`
   * and replaces the body of this method with the real call; until then every
   * approval reports `pdfGenerated: false`.
   *
   * Whatever goes in here runs *outside* the transaction and must never throw:
   * a failed voucher leaves the request APROBADA and the loan ACTIVO (Req 3.7).
   */
  private async tryGenerateVoucher(_loanId: string): Promise<boolean> {
    return false;
  }
}

export const loanRequestsService = new LoanRequestsService();
