import path from 'node:path';
import { z } from 'zod';

// Load apps/api/.env into process.env before validating. The path is resolved
// from this file (src/config or dist/config), so it works from any cwd.
// Variables already set in the environment take precedence, and a missing file
// is fine: in production the variables are injected directly.
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Printed on the loan voucher (Req 6.4). */
  INSTITUTION_NAME: z.string().min(1).default('Institución Educativa'),
  /** IANA timezone for the voucher's generation timestamp; defaults to the server's. */
  APP_TIMEZONE: z
    .string()
    .default(Intl.DateTimeFormat().resolvedOptions().timeZone)
    .refine((timeZone) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone });
        return true;
      } catch {
        return false;
      }
    }, 'APP_TIMEZONE debe ser una zona horaria IANA válida (p. ej. America/Bogota)'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
