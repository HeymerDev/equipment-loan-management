import { EventType } from '../enums.js';

/** A single recorded change within a history entry. */
export interface ChangedField {
  field: string;
  before: unknown;
  after: unknown;
}

/** Public representation of a history event. */
export interface HistoryEventDto {
  id: string;
  eventType: EventType;
  /** ID of the primary entity that was affected. */
  entityId: string;
  /** Name of the database table for lookups (e.g. "Equipment", "Loan"). */
  entityTable: string;
  userId: string;
  occurredAt: string; // ISO 8601
  /** Present for update events; lists each modified field with before/after values. */
  changedFields?: ChangedField[];
  equipmentId?: string;
  requestId?: string;
  loanId?: string;
}

/** Query parameters for GET /history. */
export interface HistoryQueryDto {
  eventType?: EventType;
  startDate?: string; // ISO 8601 date (YYYY-MM-DD)
  endDate?: string; // ISO 8601 date (YYYY-MM-DD)
  equipmentId?: string;
  userId?: string;
  page?: number;
  limit?: number;
}
