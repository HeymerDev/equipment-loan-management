import { z } from 'zod';

// ── Field rules ───────────────────────────────────────────────────────────────
// Presence, type and length live here (Req 2.1); the date business rules
// (order, past dates, overlap) belong to the service.

const equipmentId = z
  .string({ required_error: 'El equipo es requerido' })
  .uuid('El equipo seleccionado no es válido');

const purpose = z
  .string({ required_error: 'El propósito es requerido' })
  .trim()
  .min(1, 'El propósito es requerido')
  .max(500, 'El propósito no puede exceder 500 caracteres');

function dateField(label: string) {
  return z.coerce.date({
    required_error: `${label} es requerida`,
    invalid_type_error: `${label} no es una fecha válida`,
  });
}

// ── Body schemas ──────────────────────────────────────────────────────────────

/** POST /loan-requests — every field is mandatory (Req 2.1). */
export const createLoanRequestSchema = z.object({
  equipmentId,
  purpose,
  startDate: dateField('La fecha de inicio'),
  returnDate: dateField('La fecha de devolución'),
});

/** POST /loan-requests/:id/reject — the reason must be 10–500 chars (Req 3.3, 3.4). */
export const rejectLoanRequestSchema = z.object({
  rejectionReason: z
    .string({ required_error: 'El motivo de rechazo es requerido' })
    .trim()
    .min(10, 'El motivo de rechazo debe tener entre 10 y 500 caracteres')
    .max(500, 'El motivo de rechazo debe tener entre 10 y 500 caracteres'),
});

// ── Param and query schemas ───────────────────────────────────────────────────

export const loanRequestIdParamSchema = z.object({
  id: z.string().uuid('El identificador de la solicitud no es válido'),
});

const statusFilter = z.enum([
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'CANCELADA',
]);

const page = z.coerce
  .number()
  .int()
  .min(1, 'La página debe ser mayor o igual a 1')
  .default(1);

const limit = z.coerce
  .number()
  .int()
  .min(1, 'El límite debe ser mayor o igual a 1')
  .max(100, 'El límite máximo es de 100 solicitudes por página')
  .default(50);

/**
 * GET /loan-requests — the admin queue defaults to the pending requests
 * (Req 3.1); the dashboard poller sends `?status=PENDIENTE` explicitly.
 */
export const listLoanRequestsQuerySchema = z.object({
  status: statusFilter.default('PENDIENTE'),
  page,
  limit,
});

/** GET /loan-requests/my — all of the teacher's requests unless filtered (Req 2.8). */
export const myLoanRequestsQuerySchema = z.object({
  status: statusFilter.optional(),
  page,
  limit,
});

export type CreateLoanRequestInput = z.infer<typeof createLoanRequestSchema>;
export type RejectLoanRequestInput = z.infer<typeof rejectLoanRequestSchema>;
export type ListLoanRequestsQuery = z.infer<typeof listLoanRequestsQuerySchema>;
export type MyLoanRequestsQuery = z.infer<typeof myLoanRequestsQuerySchema>;
