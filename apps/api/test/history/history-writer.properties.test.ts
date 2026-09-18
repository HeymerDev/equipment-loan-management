// Task 4.3 — property tests for the history log (Properties 20 and 22).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { EventType } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { HistoryService } from '../../src/shared/history.service.js';
import { HistoryQueryService } from '../../src/modules/history/history.service.js';
import { bindTable, resetPrismaMock, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { totalCallCount } from '../helpers/assertions.js';
import { ADMIN, TEACHER, TEST_JWT_SECRET, bearer } from '../helpers/auth.js';
import jwt from 'jsonwebtoken';

const db = prisma as unknown as PrismaMock;
const writer = new HistoryService();
const reader = new HistoryQueryService();

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let server: Server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  resetPrismaMock(db);
});

const changedFieldsArb = fc.array(
  fc.record({
    field: fc.stringMatching(/^[a-zA-Z]{1,20}$/),
    before: fc.jsonValue({ maxDepth: 2 }),
    after: fc.jsonValue({ maxDepth: 2 }),
  }),
  { minLength: 1, maxLength: 6 },
);

const eventParamsArb = fc.record(
  {
    eventType: fc.constantFrom(...Object.values(EventType)),
    entityId: fc.uuid(),
    entityTable: fc.constantFrom('Equipment', 'LoanRequest', 'Loan'),
    userId: fc.uuid(),
    changedFields: changedFieldsArb,
    equipmentId: fc.uuid(),
    requestId: fc.uuid(),
    loanId: fc.uuid(),
  },
  { requiredKeys: ['eventType', 'entityId', 'entityTable', 'userId'] },
);

describe('history properties', () => {
  it('Feature: equipment-loan-management, Property 20: Completitud del esquema de entradas de historial', async () => {
    // Write side: whatever event is recorded, the row carries its type, entity
    // and author, and the before/after values exactly as given.
    await fc.assert(
      fc.asyncProperty(eventParamsArb, async (params) => {
        resetPrismaMock(db);
        db.historyEvent.create.mockResolvedValue({});

        await writer.record(params);

        expect(db.historyEvent.create).toHaveBeenCalledTimes(1);
        const { data } = db.historyEvent.create.mock.calls[0]![0];
        expect(data.eventType).toBe(params.eventType);
        expect(data.entityId).toBe(params.entityId);
        expect(data.entityTable).toBe(params.entityTable);
        expect(data.userId).toBe(params.userId);
        if (params.changedFields !== undefined) {
          expect(data.changedFields).toEqual(params.changedFields);
          for (const change of data.changedFields as Row[]) {
            expect(change).toHaveProperty('before');
            expect(change).toHaveProperty('after');
          }
        } else {
          expect(data).not.toHaveProperty('changedFields');
        }
        // The timestamp is always the database's own `now()`.
        expect(data).not.toHaveProperty('occurredAt');
      }),
      { numRuns: 100 },
    );

    // Read side: every stored entry comes back with all mandatory fields and
    // its timestamp in ISO 8601.
    const storedArb = fc.record({
      id: fc.uuid(),
      eventType: fc.constantFrom(...Object.values(EventType)),
      entityId: fc.uuid(),
      entityTable: fc.constantFrom('Equipment', 'LoanRequest', 'Loan'),
      userId: fc.uuid(),
      occurredAt: fc.date({
        min: new Date('2000-01-01T00:00:00Z'),
        max: new Date('2099-12-31T23:59:59Z'),
        noInvalidDate: true,
      }),
      changedFields: fc.option(changedFieldsArb, { nil: null }),
      equipmentId: fc.option(fc.uuid(), { nil: null }),
      requestId: fc.option(fc.uuid(), { nil: null }),
      loanId: fc.option(fc.uuid(), { nil: null }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(storedArb, { minLength: 1, maxLength: 30 }), async (rows) => {
        resetPrismaMock(db);
        bindTable(db.historyEvent, rows as unknown as Row[]);

        const result = await reader.listEvents({ page: 1, limit: 100 });

        expect(result.data).toHaveLength(rows.length);
        for (const entry of result.data) {
          const stored = rows.find((row) => row.id === entry.id)!;
          expect(entry.eventType).toBe(stored.eventType);
          expect(entry.entityId).toBe(stored.entityId);
          expect(entry.userId).toBe(stored.userId);
          expect(entry.occurredAt).toMatch(ISO_8601);
          expect(new Date(entry.occurredAt).getTime()).toBe(stored.occurredAt.getTime());
          if (stored.changedFields === null) {
            expect(entry).not.toHaveProperty('changedFields');
          } else {
            expect(entry.changedFields).toEqual(stored.changedFields);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 22: Inmutabilidad del historial', async () => {
    const unknownRoleToken = `Bearer ${jwt.sign(
      { sub: ADMIN.id, email: ADMIN.email, role: 'SUPERADMIN' },
      TEST_JWT_SECRET,
      { expiresIn: '15m' },
    )}`;

    const pathArb = fc.oneof(
      fc.constant('/api/v1/history'),
      fc.uuid().map((id) => `/api/v1/history/${id}`),
      fc.stringMatching(/^[a-z0-9-]{1,20}$/).map((segment) => `/api/v1/history/${segment}`),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('post', 'put', 'patch', 'delete'),
        pathArb,
        // Whoever asks: nobody, a teacher, an administrator, or an unknown role.
        fc.constantFrom(undefined, bearer(TEACHER), bearer(ADMIN), unknownRoleToken),
        fc.dictionary(
          fc.stringMatching(/^[a-z]{1,8}$/),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        ),
        async (method, target, authorization, body) => {
          resetPrismaMock(db);

          let req = request(server)[method as 'post' | 'put' | 'patch' | 'delete'](target);
          if (authorization !== undefined) req = req.set('Authorization', authorization);
          if (method !== 'delete') req = req.send(body);
          const res = await req;

          expect(res.status, `${method.toUpperCase()} ${target}`).toBe(404);
          expect(totalCallCount(db)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 22 (static): no code path in the API can modify or delete a history entry', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const files = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(srcDir, file));

    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const mutation = /historyEvent\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(source);
      const rawSql = /\$executeRaw|\$queryRaw/.test(source);
      return mutation || rawSql ? [path.relative(srcDir, file)] : [];
    });

    expect(files.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
