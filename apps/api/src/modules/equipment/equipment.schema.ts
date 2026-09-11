import { z } from 'zod';

// ── Field rules ───────────────────────────────────────────────────────────────
// The same limits apply on create and update (Req 1.1, 1.7). Every message names
// the offending field so the client can point at it.

const name = z
  .string({ required_error: 'El nombre es requerido' })
  .trim()
  .min(1, 'El nombre es requerido')
  .max(100, 'El nombre no puede exceder 100 caracteres');

const serialNumber = z
  .string({ required_error: 'El número de serie es requerido' })
  .trim()
  .min(1, 'El número de serie es requerido')
  .max(50, 'El número de serie no puede exceder 50 caracteres');

const description = z
  .string({ required_error: 'La descripción es requerida' })
  .trim()
  .min(1, 'La descripción es requerida')
  .max(500, 'La descripción no puede exceder 500 caracteres');

const categoryId = z
  .string({ required_error: 'La categoría es requerida' })
  .uuid('La categoría seleccionada no es válida');

// ── Body schemas ──────────────────────────────────────────────────────────────

/** POST /equipment — every field is mandatory; the status is always DISPONIBLE (Req 1.2). */
export const createEquipmentSchema = z.object({
  name,
  serialNumber,
  description,
  categoryId,
});

/** PATCH /equipment/:id — partial update; at least one field must be present. */
export const updateEquipmentSchema = z
  .object({
    name: name.optional(),
    serialNumber: serialNumber.optional(),
    description: description.optional(),
    categoryId: categoryId.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debe indicar al menos un campo para actualizar',
  });

// ── Param and query schemas ───────────────────────────────────────────────────

export const equipmentIdParamSchema = z.object({
  id: z.string().uuid('El identificador del equipo no es válido'),
});

/** Inventory listing: 50 items per page maximum (Req 1.5). */
export const listEquipmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'La página debe ser mayor o igual a 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'El límite debe ser mayor o igual a 1')
    .max(50, 'El límite máximo es de 50 equipos por página')
    .default(50),
  status: z.enum(['DISPONIBLE', 'PRESTADO']).optional(),
});

/** Equipment history: 100 entries per page maximum (Req 5.6). */
export const equipmentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'La página debe ser mayor o igual a 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'El límite debe ser mayor o igual a 1')
    .max(100, 'El límite máximo es de 100 registros por página')
    .default(100),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;
export type EquipmentHistoryQuery = z.infer<typeof equipmentHistoryQuerySchema>;
