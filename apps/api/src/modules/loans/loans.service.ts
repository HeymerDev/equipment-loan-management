import { Prisma, Role, EquipmentStatus, LoanStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  historyService,
  type ChangedField,
} from '../../shared/history.service.js';
import { daysBetween, todayStart } from '../../shared/dates.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors.js';
import type { ReturnLoanInput, ListLoansQuery } from './loans.schema.js';

/** Public representation of a loan. */
export interface LoanDto {
  id: string;
  status: LoanStatus;
  startDate: string; // ISO 8601
  agreedReturnDate: string; // ISO 8601
  actualReturnDate?: string; // ISO 8601 — present once returned
  returnedLate?: boolean;
  daysLate?: number;
  returnNotes?: string;
  /** True while the loan is still ACTIVO and the agreed day has already passed. */
  isOverdue: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  requestId: string;
  equipmentId: string;
  equipmentName: string;
  equipmentSerialNumber: string;
  teacherId: string;
  teacherName: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** Actor performing a read, used to scope what a teacher may see. */
export interface LoanActor {
  id: string;
  role: string;
}

const ENTITY_TABLE = 'Loan';

const loanSelect = {
  id: true,
  status: true,
  startDate: true,
  agreedReturnDate: true,
  actualReturnDate: true,
  returnedLate: true,
  daysLate: true,
  returnNotes: true,
  createdAt: true,
  updatedAt: true,
  requestId: true,
  equipmentId: true,
  equipment: { select: { name: true, serialNumber: true } },
  request: {
    select: { teacherId: true, teacher: { select: { fullName: true } } },
  },
} satisfies Prisma.LoanSelect;

type LoanRow = Prisma.LoanGetPayload<{ select: typeof loanSelect }>;

/**
 * A loan is overdue once the agreed day is behind us and the equipment has not
 * come back. A loan due today is not overdue yet — the same day-level rule the
 * return uses to decide whether it came back late.
 */
function isOverdue(row: LoanRow): boolean {
  return (
    row.status === LoanStatus.ACTIVO && row.agreedReturnDate < todayStart()
  );
}

function toDto(row: LoanRow): LoanDto {
  return {
    id: row.id,
    status: row.status,
    startDate: row.startDate.toISOString(),
    agreedReturnDate: row.agreedReturnDate.toISOString(),
    ...(row.actualReturnDate !== null && {
      actualReturnDate: row.actualReturnDate.toISOString(),
    }),
    ...(row.returnedLate !== null && { returnedLate: row.returnedLate }),
    ...(row.daysLate !== null && { daysLate: row.daysLate }),
    ...(row.returnNotes !== null && { returnNotes: row.returnNotes }),
    isOverdue: isOverdue(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requestId: row.requestId,
    equipmentId: row.equipmentId,
    equipmentName: row.equipment.name,
    equipmentSerialNumber: row.equipment.serialNumber,
    teacherId: row.request.teacherId,
    teacherName: row.request.teacher.fullName,
  };
}

export class LoansService {
  /**
   * Loans still out, soonest due first so the overdue ones lead the list
   * (Req 4.5). Each row carries the teacher, the equipment, both dates and the
   * overdue flag.
   */
  async listActiveLoans(
    query: ListLoansQuery,
  ): Promise<PaginatedResult<LoanDto>> {
    const { page, limit, status } = query;
    const where: Prisma.LoanWhereInput = { status };

    const [rows, total] = await prisma.$transaction([
      prisma.loan.findMany({
        where,
        select: loanSelect,
        orderBy: [{ agreedReturnDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.loan.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: { page, limit, total } };
  }

  /** Detail of a loan. A teacher may only read their own (Req 7.6). */
  async getLoanById(id: string, actor: LoanActor): Promise<LoanDto> {
    const loan = await prisma.loan.findUnique({
      where: { id },
      select: loanSelect,
    });

    if (!loan) throw new NotFoundError('Préstamo');

    if (
      actor.role !== Role.ADMINISTRADOR &&
      loan.request.teacherId !== actor.id
    ) {
      throw new ForbiddenError('No tiene permisos para ver este préstamo');
    }

    return toDto(loan);
  }

  /**
   * Registers a return: the loan closes, the equipment goes back to the
   * inventory and the history entry is written in one transaction (Req 4.1,
   * Property 16). Only ACTIVO loans can be returned (Req 4.4).
   */
  async returnLoan(
    id: string,
    input: ReturnLoanInput,
    adminId: string,
  ): Promise<LoanDto> {
    const loan = await prisma.loan.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        agreedReturnDate: true,
        equipmentId: true,
      },
    });

    if (!loan) throw new NotFoundError('Préstamo');

    if (loan.status !== LoanStatus.ACTIVO) {
      throw new ConflictError(
        'El préstamo no está activo y no admite registro de devolución',
      );
    }

    // The exact instant is stored (Req 4.1); lateness is counted in whole days.
    const actualReturnDate = new Date();
    const daysLate = Math.max(
      0,
      daysBetween(loan.agreedReturnDate, actualReturnDate),
    );
    const returnedLate = daysLate > 0;

    const changedFields: ChangedField[] = [
      {
        field: 'status',
        before: LoanStatus.ACTIVO,
        after: LoanStatus.FINALIZADO,
      },
      {
        field: 'actualReturnDate',
        before: null,
        after: actualReturnDate.toISOString(),
      },
      { field: 'returnedLate', before: null, after: returnedLate },
    ];

    if (returnedLate) {
      changedFields.push({ field: 'daysLate', before: null, after: daysLate });
    }

    if (input.returnNotes !== undefined) {
      changedFields.push({
        field: 'returnNotes',
        before: null,
        after: input.returnNotes,
      });
    }

    const returned = await prisma.$transaction(async (tx) => {
      const updated = await tx.loan.update({
        where: { id },
        data: {
          status: LoanStatus.FINALIZADO,
          actualReturnDate,
          returnedLate,
          daysLate: returnedLate ? daysLate : 0,
          ...(input.returnNotes !== undefined && {
            returnNotes: input.returnNotes,
          }),
        },
        select: loanSelect,
      });

      await tx.equipment.update({
        where: { id: loan.equipmentId },
        data: { status: EquipmentStatus.DISPONIBLE },
      });

      await historyService.record({
        eventType: 'LOAN_RETURNED',
        entityId: id,
        entityTable: ENTITY_TABLE,
        userId: adminId,
        equipmentId: loan.equipmentId,
        requestId: updated.requestId,
        loanId: id,
        changedFields,
        tx,
      });

      return updated;
    });

    return toDto(returned);
  }
}

export const loansService = new LoansService();
