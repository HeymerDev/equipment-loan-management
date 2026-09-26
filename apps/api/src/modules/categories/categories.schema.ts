import { z } from 'zod';

/** Longitud máxima del nombre de una categoría. */
export const CATEGORY_NAME_MAX = 50;

const name = z
  .string({ required_error: 'El nombre es requerido' })
  .trim()
  .min(1, 'El nombre es requerido')
  .max(
    CATEGORY_NAME_MAX,
    `El nombre no puede exceder ${CATEGORY_NAME_MAX} caracteres`,
  );

/** POST /categories */
export const createCategorySchema = z.object({ name });

/** PATCH /categories/:id */
export const updateCategorySchema = z.object({ name });

export const categoryIdParamSchema = z.object({
  id: z.string().uuid('El identificador de la categoría no es válido'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
