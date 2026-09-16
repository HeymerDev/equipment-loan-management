import { z } from 'zod';
import { EventType } from '@prisma/client';
import { toDayStart } from '../../shared/dates.js';

/** A calendar day from the query string; unparseable text gets a Spanish message too. */
function dayField(label: string) {
  const invalid = `${label} no es una fecha válida`;
  return z
    .string({ invalid_type_error: invalid })
    .pipe(z.coerce.date({ errorMap: () => ({ message: invalid }) }));
}

/**
 * GET /history — every filter is optional and they all apply at once (Req 5.3).
 * Dates are calendar days (YYYY-MM-DD) and both ends are inclusive.
 */
export const historyQuerySchema = z
  .object({
    eventType: z
      .nativeEnum(EventType, {
        errorMap: () => ({ message: 'El tipo de evento no es válido' }),
      })
      .optional(),
    startDate: dayField('La fecha de inicio').optional(),
    endDate: dayField('La fecha de fin').optional(),
    equipmentId: z
      .string()
      .uuid('El identificador del equipo no es válido')
      .optional(),
    userId: z
      .string()
      .uuid('El identificador del usuario no es válido')
      .optional(),
    page: z.coerce
      .number()
      .int()
      .min(1, 'La página debe ser mayor o igual a 1')
      .default(1),
    // 100 entries per page maximum (Req 5.5).
    limit: z.coerce
      .number()
      .int()
      .min(1, 'El límite debe ser mayor o igual a 1')
      .max(100, 'El límite máximo es de 100 registros por página')
      .default(100),
  })
  .refine(
    (query) =>
      query.startDate === undefined ||
      query.endDate === undefined ||
      toDayStart(query.startDate) <= toDayStart(query.endDate),
    {
      message:
        'El rango de fechas es inválido: la fecha de inicio es posterior a la fecha de fin',
      path: ['endDate'],
    },
  );

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
