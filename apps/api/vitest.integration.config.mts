import { defineConfig } from 'vitest/config';

/**
 * Integration suite: services and HTTP routes against a real PostgreSQL.
 *
 * It only runs when TEST_DATABASE_URL is set explicitly — it never falls back
 * to DATABASE_URL, so it cannot be pointed at a database by accident. Use a
 * disposable database (see docker-compose.test.yml); the global setup applies
 * the migrations. Every file tags the rows it creates and deletes them after.
 */
const url = process.env['TEST_DATABASE_URL'];
if (!url) {
  throw new Error(
    'Integration tests need TEST_DATABASE_URL, pointing to a disposable PostgreSQL database. ' +
      'Example: docker compose -f docker-compose.test.yml up -d, then ' +
      'TEST_DATABASE_URL=postgresql://test:test@localhost:54329/equipment_loan_test pnpm test:integration',
  );
}

export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    // Files share one database; run them one after another.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_SECRET: 'integration-test-jwt-secret-0123456789',
      JWT_REFRESH_SECRET: 'integration-test-refresh-secret-0123456789',
      INSTITUTION_NAME: 'Colegio de Integración',
      APP_TIMEZONE: 'UTC',
    },
  },
});
