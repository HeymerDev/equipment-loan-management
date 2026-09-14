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
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
