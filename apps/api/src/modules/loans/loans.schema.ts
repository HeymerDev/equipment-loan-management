import { z } from 'zod';

/** POST /loans/:id/return — the notes are optional (Req 4.2). */
export const returnLoanSchema = z.object({
  returnNotes: z
    .string()
    .trim()
    .max(500, 'Las observaciones no pueden exceder 500 caracteres')
    .optional(),
});

export const loanIdParamSchema = z.object({
  id: z.string().uuid('El identificador del préstamo no es válido'),
});

/** GET /loans — the admin view defaults to the loans still out (Req 4.5). */
export const listLoansQuerySchema = z.object({
  status: z.enum(['ACTIVO', 'FINALIZADO']).default('ACTIVO'),
  page: z.coerce
    .number()
    .int()
    .min(1, 'La página debe ser mayor o igual a 1')
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'El límite debe ser mayor o igual a 1')
    .max(100, 'El límite máximo es de 100 préstamos por página')
    .default(50),
});

export type ReturnLoanInput = z.infer<typeof returnLoanSchema>;
export type ListLoansQuery = z.infer<typeof listLoansQuerySchema>;
