// Task 9.2 — property tests for history queries (Properties 21, 23 and 24).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import type { Server } from 'node:http';
import { EventType } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { historyQueryService, type HistoryEventDto } from '../../src/modules/history/history.service.js';
import { historyQuerySchema } from '../../src/modules/history/history.schema.js';
import { bindTable, resetPrismaMock, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { totalCallCount } from '../helpers/assertions.js';
import { ADMIN, bearer } from '../helpers/auth.js';
import { utcDay } from '../helpers/world.js';

const db = prisma as unknown as PrismaMock;
const DAY_MS = 86_400_000;
const BASE = new Date('2026-06-15T00:00:00Z');

const EQUIPMENT_POOL = [
  'e0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000003',
];
const USER_POOL = [
  'a0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000003',
];

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

const eventArb = fc.record({
  id: fc.uuid(),
  eventType: fc.constantFrom(...Object.values(EventType)),
  entityId: fc.uuid(),
  entityTable: fc.constantFrom('Equipment', 'LoanRequest', 'Loan'),
  userId: fc.constantFrom(...USER_POOL),
  equipmentId: fc.option(fc.constantFrom(...EQUIPMENT_POOL), { nil: null }),
  requestId: fc.constant(null),
  loanId: fc.constant(null),
  changedFields: fc.constant(null),
  // Includes exact midnights, to probe the inclusive day boundaries.
  occurredAt: fc.oneof(
    fc.integer({ min: -10 * DAY_MS, max: 10 * DAY_MS }).map((ms) => new Date(BASE.getTime() + ms)),
    fc.integer({ min: -10, max: 10 }).map((days) => utcDay(days, BASE)),
    fc.integer({ min: -9, max: 10 }).map((days) => new Date(utcDay(days, BASE).getTime() - 1)),
  ),
});

const eventsArb = fc.uniqueArray(eventArb, { maxLength: 160, selector: (event) => event.id });

const dayStringArb = fc.integer({ min: -12, max: 12 }).map((days) => utcDay(days, BASE).toISOString().slice(0, 10));

const filtersArb = fc
  .record(
    {
      eventType: fc.constantFrom(...Object.values(EventType)),
      equipmentId: fc.constantFrom(...EQUIPMENT_POOL),
      userId: fc.constantFrom(...USER_POOL),
      startDate: dayStringArb,
      endDate: dayStringArb,
    },
    { requiredKeys: [] },
  )
  .filter((f) => f.startDate === undefined || f.endDate === undefined || f.startDate <= f.endDate);

type Filters = { eventType?: string; equipmentId?: string; userId?: string; startDate?: string; endDate?: string };

/** Independent oracle, working on calendar-day strings rather than timestamps. */
function satisfies(event: Row, filters: Filters): boolean {
  const day = (event['occurredAt'] as Date).toISOString().slice(0, 10);
  return (
    (filters.eventType === undefined || event['eventType'] === filters.eventType) &&
    (filters.equipmentId === undefined || event['equipmentId'] === filters.equipmentId) &&
    (filters.userId === undefined || event['userId'] === filters.userId) &&
    (filters.startDate === undefined || day >= filters.startDate) &&
    (filters.endDate === undefined || day <= filters.endDate)
  );
}

async function walkPages(filters: Filters, limit: number): Promise<HistoryEventDto[][]> {
  const pages: HistoryEventDto[][] = [];
  for (let page = 1; page <= 200; page++) {
    const result = await historyQueryService.listEvents(historyQuerySchema.parse({ ...filters, page, limit }));
    pages.push(result.data);
    if (result.data.length < limit) break;
  }
  return pages;
}

describe('history query properties', () => {
  it('Feature: equipment-loan-management, Property 21: Composición de filtros en consultas de historial', async () => {
    await fc.assert(
      fc.asyncProperty(eventsArb, filtersArb, async (events, filters) => {
        resetPrismaMock(db);
        bindTable(db.historyEvent, events as unknown as Row[]);

        const results = (await walkPages(filters, 100)).flat();

        // Every returned entry satisfies all n filters at once…
        for (const entry of results) {
          const stored = events.find((event) => event.id === entry.id)! as unknown as Row;
          expect(satisfies(stored, filters), JSON.stringify({ filters, entry })).toBe(true);
        }
        // …and no matching entry is left out.
        const expected = (events as unknown as Row[]).filter((event) => satisfies(event, filters));
        expect(results.map((entry) => entry.id).sort()).toEqual(expected.map((e) => e['id'] as string).sort());
      }),
      { numRuns: 200 },
    );
  });

  it('Feature: equipment-loan-management, Property 23: Paginación y ordenamiento del historial', async () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 1_000_000 }), (limit) => {
        expect(historyQuerySchema.safeParse({ limit }).success).toBe(false);
      }),
      { numRuns: 100 },
    );

    // Coarse timestamps produce ties on purpose.
    const tiedEventsArb = fc.uniqueArray(
      eventArb.map((event) => ({
        ...event,
        occurredAt: new Date(BASE.getTime() + (Math.floor(event.occurredAt.getTime() / 3_600_000) % 6) * 3_600_000),
      })),
      { maxLength: 250, selector: (event) => event.id },
    );

    await fc.assert(
      fc.asyncProperty(
        tiedEventsArb,
        fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
        filtersArb,
        async (events, limit, filters) => {
          resetPrismaMock(db);
          bindTable(db.historyEvent, events as unknown as Row[]);
          const pageSize = limit ?? 100;

          const pages = await walkPages(filters, pageSize);

          for (const page of pages) expect(page.length).toBeLessThanOrEqual(Math.min(pageSize, 100));
          const flat = pages.flat();
          for (let i = 1; i < flat.length; i++) {
            expect(flat[i - 1]!.occurredAt >= flat[i]!.occurredAt).toBe(true);
          }
          expect(new Set(flat.map((entry) => entry.id)).size).toBe(flat.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: equipment-loan-management, Property 24: Rechazo de rangos de fecha inválidos en historial', async () => {
    const dayArb = fc
      .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true })
      .map((date) => date.toISOString().slice(0, 10));

    await fc.assert(
      fc.asyncProperty(dayArb, dayArb, async (a, b) => {
        fc.pre(a !== b);
        const [startDate, endDate] = a > b ? [a, b] : [b, a]; // start strictly after end
        resetPrismaMock(db);

        const parsed = historyQuerySchema.safeParse({ startDate, endDate });
        expect(parsed.success).toBe(false);

        const res = await request(server)
          .get(`/api/v1/history?startDate=${startDate}&endDate=${endDate}`)
          .set('Authorization', bearer(ADMIN));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'VALIDATION_ERROR',
          field: 'endDate',
          message: 'El rango de fechas es inválido: la fecha de inicio es posterior a la fecha de fin',
        });
        expect(totalCallCount(db)).toBe(0);

        // The same day on both ends is a valid, one-day range.
        expect(historyQuerySchema.safeParse({ startDate: endDate, endDate }).success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
