import { Prisma, EquipmentStatus, LoanStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  historyService,
  type ChangedField,
} from '../../shared/history.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.js';
import type {
  CreateEquipmentInput,
  UpdateEquipmentInput,
  ListEquipmentQuery,
  EquipmentHistoryQuery,
} from './equipment.schema.js';

/** Public representation of a piece of equipment. */
export interface EquipmentDto {
  id: string;
  name: string;
  serialNumber: string;
  description: string;
  status: EquipmentStatus;
  categoryId: string;
  categoryName: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** A history entry as returned by `GET /equipment/:id/history`. */
export interface EquipmentHistoryEntryDto {
  id: string;
  eventType: string;
  entityId: string;
  entityTable: string;
  userId: string;
  occurredAt: string; // ISO 8601
  changedFields?: ChangedField[];
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

const ENTITY_TABLE = 'Equipment';

const equipmentSelect = {
  id: true,
  name: true,
  serialNumber: true,
  description: true,
  status: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { name: true } },
} satisfies Prisma.EquipmentSelect;

type EquipmentRow = Prisma.EquipmentGetPayload<{ select: typeof equipmentSelect }>;

function toDto(row: EquipmentRow): EquipmentDto {
  return {
    id: row.id,
    name: row.name,
    serialNumber: row.serialNumber,
    description: row.description,
    status: row.status,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class EquipmentService {
  /**
   * Active inventory, 50 items per page (Req 1.5). Soft-deleted equipment is
   * excluded so it can never be picked for a new loan (Req 1.8).
   */
  async listEquipment(
    query: ListEquipmentQuery,
  ): Promise<PaginatedResult<EquipmentDto>> {
    const { page, limit, status } = query;

    const where: Prisma.EquipmentWhereInput = {
      deletedAt: null,
      ...(status !== undefined && { status }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.equipment.findMany({
        where,
        select: equipmentSelect,
        // `id` breaks ties so pagination stays stable across pages.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.equipment.count({ where }),
    ]);

    return {
      data: rows.map(toDto),
      meta: { page, limit, total },
    };
  }

  /** Detail of a single active piece of equipment. */
  async getEquipmentById(id: string): Promise<EquipmentDto> {
    const row = await prisma.equipment.findFirst({
      where: { id, deletedAt: null },
      select: equipmentSelect,
    });

    if (!row) throw new NotFoundError('Equipo');

    return toDto(row);
  }

  /**
   * Registers new equipment with status DISPONIBLE and a unique id (Req 1.2),
   * rejecting duplicate serial numbers without persisting anything (Req 1.6).
   */
  async createEquipment(
    input: CreateEquipmentInput,
    actorId: string,
  ): Promise<EquipmentDto> {
    await this.assertCategoryExists(input.categoryId);
    await this.assertSerialNumberIsFree(input.serialNumber);

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.equipment.create({
          data: {
            name: input.name,
            serialNumber: input.serialNumber,
            description: input.description,
            categoryId: input.categoryId,
            status: EquipmentStatus.DISPONIBLE,
          },
          select: equipmentSelect,
        });

        await historyService.record({
          eventType: 'EQUIPMENT_CREATED',
          entityId: created.id,
          entityTable: ENTITY_TABLE,
          userId: actorId,
          equipmentId: created.id,
          tx,
        });

        return toDto(created);
      });
    } catch (err) {
      // Guards against a concurrent insert slipping past the check above.
      throw this.translateUniqueViolation(err);
    }
  }

  /**
   * Applies a partial update and records exactly one EQUIPMENT_UPDATED entry
   * carrying the before/after value of every modified field (Req 1.3).
   */
  async updateEquipment(
    id: string,
    input: UpdateEquipmentInput,
    actorId: string,
  ): Promise<EquipmentDto> {
    const current = await prisma.equipment.findFirst({
      where: { id, deletedAt: null },
      select: equipmentSelect,
    });

    if (!current) throw new NotFoundError('Equipo');

    if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
      await this.assertCategoryExists(input.categoryId);
    }

    if (
      input.serialNumber !== undefined &&
      input.serialNumber !== current.serialNumber
    ) {
      await this.assertSerialNumberIsFree(input.serialNumber, id);
    }

    const changedFields = this.diff(current, input);

    // Nothing actually changed — leave the history untouched so every
    // EQUIPMENT_UPDATED entry corresponds to a real modification.
    if (changedFields.length === 0) return toDto(current);

    const data: Prisma.EquipmentUpdateInput = {};
    for (const change of changedFields) {
      if (change.field === 'categoryId') {
        data.category = { connect: { id: change.after as string } };
      } else {
        // `field` is constrained to the scalar names compared in `diff`.
        (data as Record<string, unknown>)[change.field] = change.after;
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.equipment.update({
          where: { id },
          data,
          select: equipmentSelect,
        });

        await historyService.record({
          eventType: 'EQUIPMENT_UPDATED',
          entityId: updated.id,
          entityTable: ENTITY_TABLE,
          userId: actorId,
          equipmentId: updated.id,
          changedFields,
          tx,
        });

        return toDto(updated);
      });
    } catch (err) {
      throw this.translateUniqueViolation(err);
    }
  }

  /**
   * Soft-deletes available equipment (Req 1.8). Equipment tied to an active
   * loan cannot be removed (Req 1.9).
   */
  async deleteEquipment(id: string, actorId: string): Promise<void> {
    const current = await prisma.equipment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!current) throw new NotFoundError('Equipo');

    const activeLoans = await prisma.loan.count({
      where: { equipmentId: id, status: LoanStatus.ACTIVO },
    });

    if (activeLoans > 0 || current.status === EquipmentStatus.PRESTADO) {
      throw new ConflictError(
        'El equipo tiene un préstamo activo y no puede ser eliminado',
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.equipment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await historyService.record({
        eventType: 'EQUIPMENT_DELETED',
        entityId: id,
        entityTable: ENTITY_TABLE,
        userId: actorId,
        equipmentId: id,
        tx,
      });
    });
  }

  /**
   * Full event log of a piece of equipment, newest first, 100 per page (Req 5.6).
   * Soft-deleted equipment keeps its history for auditing.
   */
  async listEquipmentHistory(
    id: string,
    query: EquipmentHistoryQuery,
  ): Promise<PaginatedResult<EquipmentHistoryEntryDto>> {
    const { page, limit } = query;

    const exists = await prisma.equipment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) throw new NotFoundError('Equipo');

    const where: Prisma.HistoryEventWhereInput = { equipmentId: id };

    const [rows, total] = await prisma.$transaction([
      prisma.historyEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.historyEvent.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        entityId: row.entityId,
        entityTable: row.entityTable,
        userId: row.userId,
        occurredAt: row.occurredAt.toISOString(),
        ...(row.changedFields !== null && {
          changedFields: row.changedFields as unknown as ChangedField[],
        }),
      })),
      meta: { page, limit, total },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new ValidationError(
        'La categoría seleccionada no existe',
        'categoryId',
      );
    }
  }

  /**
   * Serial numbers are unique across the whole table — soft-deleted equipment
   * still holds on to its serial number, so it also blocks a reuse.
   */
  private async assertSerialNumberIsFree(
    serialNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await prisma.equipment.findUnique({
      where: { serialNumber },
      select: { id: true },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictError('El número de serie ya está en uso');
    }
  }

  /** Builds the before/after list for the fields the update actually changes. */
  private diff(
    current: EquipmentRow,
    input: UpdateEquipmentInput,
  ): ChangedField[] {
    const comparable = [
      'name',
      'serialNumber',
      'description',
      'categoryId',
    ] as const;
    const changes: ChangedField[] = [];

    for (const field of comparable) {
      const after = input[field];
      const before = current[field];

      if (after !== undefined && after !== before) {
        changes.push({ field, before, after });
      }
    }

    return changes;
  }

  /** Maps a Prisma unique-constraint violation on `serialNumber` to a 409. */
  private translateUniqueViolation(err: unknown): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictError('El número de serie ya está en uso');
    }

    return err;
  }
}

export const equipmentService = new EquipmentService();
