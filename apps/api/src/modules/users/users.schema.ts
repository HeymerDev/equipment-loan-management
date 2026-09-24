import { z } from 'zod';
import { Role } from '@prisma/client';

/** POST /users — an administrator registers a teacher or another administrator. */
export const createUserSchema = z.object({
  fullName: z
    .string({ required_error: 'El nombre es requerido' })
    .trim()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre no puede exceder 100 caracteres'),
  email: z
    .string({ required_error: 'El email es requerido' })
    .trim()
    .toLowerCase()
    .email('El email no es válido')
    .max(255, 'El email no puede exceder 255 caracteres'),
  role: z.nativeEnum(Role, {
    required_error: 'El rol es requerido',
    invalid_type_error: 'El rol no es válido',
  }),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
