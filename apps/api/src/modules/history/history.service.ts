import type { EventType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { ChangedField } from '../../shared/history.service.js';
import { toDayStart } from '../../shared/dates.js';

/** Public representation of a history event. */
export interface HistoryEventDto {
  id: string;
  eventType: EventType;
  entityId: string;
  entityTable: string;
  userId: string;
  occurredAt: string; // ISO 8601
  changedFields?: ChangedField[];
  equipmentId?: string;
  requestId?: string;
  loanId?: string;
}

export interface HistoryFilters {
  eventType?: EventType;
  /** Inclusive: events from the start of this day. */
  startDate?: Date;
  /** Inclusive: events up to the end of this day. */
  endDate?: Date;
  equipmentId?: string;
  userId?: string;
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type HistoryRow = Prisma.HistoryEventGetPayload<Record<string, never>>;

function toDto(row: HistoryRow): HistoryEventDto {
  return {
    id: row.id,
    eventType: row.eventType,
    entityId: row.entityId,
    entityTable: row.entityTable,
    userId: row.userId,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.changedFields !== null && {
      changedFields: row.changedFields as unknown as ChangedField[],
    }),
    ...(row.equipmentId !== null && { equipmentId: row.equipmentId }),
    ...(row.requestId !== null && { requestId: row.requestId }),
    ...(row.loanId !== null && { loanId: row.loanId }),
  };
}

/**
 * Read side of the history log. Writes go through `shared/history.service.ts`
 * and nothing in the API updates or deletes an entry (Req 5.4).
 */
export class HistoryQueryService {
  /**
   * Events matching every given filter, newest first, paginated (Req 5.3,
   * 5.5, 5.6).
   */
  async listEvents(
    filters: HistoryFilters,
  ): Promise<PaginatedResult<HistoryEventDto>> {
    const { eventType, startDate, endDate, equipmentId, userId, page, limit } =
      filters;

    const occurredAt: Prisma.DateTimeFilter = {
      ...(startDate !== undefined && { gte: toDayStart(startDate) }),
      // Strictly before the next day's start keeps the whole end day inclusive.
      ...(endDate !== undefined && {
        lt: new Date(toDayStart(endDate).getTime() + MS_PER_DAY),
      }),
    };

    const where: Prisma.HistoryEventWhereInput = {
      ...(eventType !== undefined && { eventType }),
      ...(equipmentId !== undefined && { equipmentId }),
      ...(userId !== undefined && { userId }),
      ...((startDate !== undefined || endDate !== undefined) && { occurredAt }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.historyEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.historyEvent.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: { page, limit, total } };
  }
}

export const historyQueryService = new HistoryQueryService();
