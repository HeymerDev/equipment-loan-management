import { execSync } from 'node:child_process';
import path from 'node:path';

/** Brings the test database schema up to date before any file runs. */
export default function setup(): void {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is required');

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      // An explicit DATABASE_URL wins over the one in .env.
      DATABASE_URL: url,
      // Behind a connection pooler (PgBouncer, Neon "-pooler" hosts) the
      // migration advisory lock can stay held by a pooled session and time out
      // (P1002). This suite is the database's only migrator, so skip the lock.
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
    },
  });
}
