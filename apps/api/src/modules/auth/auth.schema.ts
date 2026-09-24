import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('El email no es válido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Minimum length of a password a user sets for themselves. */
export const MIN_PASSWORD_LENGTH = 8;

/** POST /auth/change-password */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'La contraseña actual es requerida' })
    .min(1, 'La contraseña actual es requerida'),
  newPassword: z
    .string({ required_error: 'La nueva contraseña es requerida' })
    .min(
      MIN_PASSWORD_LENGTH,
      `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    )
    // bcrypt only reads the first 72 bytes.
    .max(72, 'La nueva contraseña no puede exceder 72 caracteres'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
