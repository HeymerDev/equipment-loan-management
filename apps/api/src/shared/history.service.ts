import type { EventType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

/** A single field change captured inside an update event. */
export interface ChangedField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface RecordEventParams {
  /** Strictly one of the event types defined in the Prisma `EventType` enum. */
  eventType: EventType;
  /** ID of the primary entity affected by the event. */
  entityId: string;
  /** Table the entity lives in, for lookups (e.g. "Equipment", "LoanRequest", "Loan"). */
  entityTable: string;
  /** User that triggered the action. */
  userId: string;
  /** Present on update events; one entry per modified field with its before/after values. */
  changedFields?: ChangedField[];
  equipmentId?: string;
  requestId?: string;
  loanId?: string;
  /**
   * Prisma transaction client. Pass it when the event belongs to an atomic
   * operation so the entry rolls back together with the rest of the changes.
   */
  tx?: Prisma.TransactionClient;
}

/**
 * Centralised writer for the immutable `HistoryEvent` table.
 *
 * Every business module records its events through this service — history is
 * never written directly from a router, and there are no update/delete methods
 * because the log is append-only (Req 5.4).
 */
export class HistoryService {
  async record(params: RecordEventParams): Promise<void> {
    const {
      tx,
      eventType,
      entityId,
      entityTable,
      userId,
      changedFields,
      equipmentId,
      requestId,
      loanId,
    } = params;

    // Inside a transaction we must use the transaction client so the entry
    // shares the same atomic scope as the operation that produced it.
    const client: Prisma.TransactionClient = tx ?? prisma;

    await client.historyEvent.create({
      data: {
        eventType,
        entityId,
        entityTable,
        userId,
        // `occurredAt` comes from the DB default (now()), stored as ISO 8601.
        ...(changedFields !== undefined && {
          changedFields: changedFields as unknown as Prisma.InputJsonValue,
        }),
        ...(equipmentId !== undefined && { equipmentId }),
        ...(requestId !== undefined && { requestId }),
        ...(loanId !== undefined && { loanId }),
      },
    });
  }
}

export const historyService = new HistoryService();
