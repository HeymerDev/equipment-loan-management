import { defineConfig } from 'vitest/config';

/**
 * Unit and property suite. Prisma is mocked in every test file, so this suite
 * never touches a database; the DATABASE_URL below exists only to satisfy the
 * env schema and points nowhere on purpose.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/never_connects',
      JWT_SECRET: 'unit-test-jwt-secret-0123456789',
      JWT_REFRESH_SECRET: 'unit-test-refresh-secret-0123456789',
      INSTITUTION_NAME: 'Colegio de Pruebas',
      APP_TIMEZONE: 'UTC',
    },
  },
});
