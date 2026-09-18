// Task 9.3 — unit tests for history queries.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { historyQueryService } from '../../src/modules/history/history.service.js';
import { historyQuerySchema } from '../../src/modules/history/history.schema.js';
import { bindTable, resetPrismaMock, type PrismaMock, type Row } from '../helpers/prisma-mock.js';
import { ADMIN, TEACHER, bearer } from '../helpers/auth.js';

const db = prisma as unknown as PrismaMock;

const EQ_A = 'e0000000-0000-4000-8000-00000000000a';
const EQ_B = 'e0000000-0000-4000-8000-00000000000b';

let rows: Row[];
let seq = 0;

function event(fields: Row): Row {
  seq += 1;
  const row: Row = {
    id: `h0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    eventType: 'EQUIPMENT_UPDATED',
    entityId: EQ_A,
    entityTable: 'Equipment',
    userId: ADMIN.id,
    occurredAt: new Date('2026-06-15T12:00:00Z'),
    changedFields: null,
    equipmentId: EQ_A,
    requestId: null,
    loanId: null,
    ...fields,
  };
  rows.push(row);
  return row;
}

const query = (input: Record<string, unknown>) =>
  historyQueryService.listEvents(historyQuerySchema.parse(input));
const ids = (result: { data: Array<{ id: string }> }) => result.data.map((entry) => entry.id);

let server: Server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  resetPrismaMock(db);
  rows = [];
  bindTable(db.historyEvent, rows);
});

describe('historyQueryService.listEvents', () => {
  it('returns every entry, newest first, 100 per page by default (Req 5.5)', async () => {
    const old = event({ occurredAt: new Date('2026-06-01T00:00:00Z') });
    const recent = event({ occurredAt: new Date('2026-06-20T00:00:00Z') });

    const result = await query({});

    expect(ids(result)).toEqual([recent['id'], old['id']]);
    expect(result.meta).toEqual({ page: 1, limit: 100, total: 2 });
  });

  it('filters by event type', async () => {
    const created = event({ eventType: 'EQUIPMENT_CREATED' });
    event({ eventType: 'LOAN_STARTED' });

    const result = await query({ eventType: 'EQUIPMENT_CREATED' });

    expect(ids(result)).toEqual([created['id']]);
  });

  it('treats both ends of the date range as whole, inclusive days', async () => {
    event({ occurredAt: new Date('2026-06-09T23:59:59.999Z') }); // day before start
    const firstInstant = event({ occurredAt: new Date('2026-06-10T00:00:00.000Z') });
    const lastInstant = event({ occurredAt: new Date('2026-06-12T23:59:59.999Z') });
    event({ occurredAt: new Date('2026-06-13T00:00:00.000Z') }); // day after end

    const result = await query({ startDate: '2026-06-10', endDate: '2026-06-12' });

    expect(ids(result).sort()).toEqual([firstInstant['id'], lastInstant['id']].sort());
  });

  it('accepts a single-day range', async () => {
    const same = event({ occurredAt: new Date('2026-06-10T18:00:00Z') });
    event({ occurredAt: new Date('2026-06-11T00:00:00Z') });

    const result = await query({ startDate: '2026-06-10', endDate: '2026-06-10' });

    expect(ids(result)).toEqual([same['id']]);
  });

  it('supports open-ended ranges', async () => {
    const before = event({ occurredAt: new Date('2026-06-01T00:00:00Z') });
    const after = event({ occurredAt: new Date('2026-06-30T00:00:00Z') });

    expect(ids(await query({ startDate: '2026-06-15' }))).toEqual([after['id']]);
    expect(ids(await query({ endDate: '2026-06-15' }))).toEqual([before['id']]);
  });

  it('applies combined filters as an intersection (eventType + equipmentId + userId)', async () => {
    const match = event({ eventType: 'LOAN_STARTED', equipmentId: EQ_A, userId: ADMIN.id });
    event({ eventType: 'LOAN_STARTED', equipmentId: EQ_B, userId: ADMIN.id });
    event({ eventType: 'LOAN_RETURNED', equipmentId: EQ_A, userId: ADMIN.id });
    event({ eventType: 'LOAN_STARTED', equipmentId: EQ_A, userId: TEACHER.id });

    const result = await query({ eventType: 'LOAN_STARTED', equipmentId: EQ_A, userId: ADMIN.id });

    expect(ids(result)).toEqual([match['id']]);
    expect(result.meta.total).toBe(1);
  });

  it('paginates with a stable order when timestamps tie', async () => {
    const at = new Date('2026-06-15T08:00:00Z');
    for (let i = 0; i < 5; i++) event({ occurredAt: at });

    const first = await query({ limit: 2, page: 1 });
    const second = await query({ limit: 2, page: 2 });
    const third = await query({ limit: 2, page: 3 });

    const all = [...ids(first), ...ids(second), ...ids(third)];
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect(first.meta.total).toBe(5);
  });

  it('omits the optional links that are null and keeps changedFields when present', async () => {
    event({ changedFields: [{ field: 'name', before: 'A', after: 'B' }], requestId: null, loanId: null });

    const [entry] = (await query({})).data;

    expect(entry).toMatchObject({ equipmentId: EQ_A, changedFields: [{ field: 'name', before: 'A', after: 'B' }] });
    expect(entry).not.toHaveProperty('requestId');
    expect(entry).not.toHaveProperty('loanId');
  });
});

describe('historyQuerySchema (Req 5.3, 5.7)', () => {
  it('rejects a start date after the end date, on the endDate field', () => {
    const parsed = historyQuerySchema.safeParse({ startDate: '2026-06-12', endDate: '2026-06-10' });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['endDate'],
      message: 'El rango de fechas es inválido: la fecha de inicio es posterior a la fecha de fin',
    });
  });

  it.each([
    [{ eventType: 'EQUIPMENT_EXPLODED' }, 'El tipo de evento no es válido'],
    [{ equipmentId: 'abc' }, 'El identificador del equipo no es válido'],
    [{ userId: 'abc' }, 'El identificador del usuario no es válido'],
    [{ startDate: 'ayer' }, 'La fecha de inicio no es una fecha válida'],
    [{ limit: 101 }, 'El límite máximo es de 100 registros por página'],
    [{ page: 0 }, 'La página debe ser mayor o igual a 1'],
  ])('rejects %o', (input, message) => {
    const parsed = historyQuerySchema.safeParse(input);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(message);
  });
});

describe('GET /history', () => {
  it('answers 400 with the range message and 403 for teachers', async () => {
    const invalid = await request(server)
      .get('/api/v1/history?startDate=2026-06-12&endDate=2026-06-10')
      .set('Authorization', bearer(ADMIN));
    const asTeacher = await request(server).get('/api/v1/history').set('Authorization', bearer(TEACHER));

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe(
      'El rango de fechas es inválido: la fecha de inicio es posterior a la fecha de fin',
    );
    expect(asTeacher.status).toBe(403);
  });

  it('serves filtered, paginated results to administrators', async () => {
    const match = event({ eventType: 'REQUEST_CREATED', occurredAt: new Date('2026-06-10T09:00:00Z') });
    event({ eventType: 'REQUEST_CREATED', occurredAt: new Date('2026-07-10T09:00:00Z') });

    const res = await request(server)
      .get('/api/v1/history?eventType=REQUEST_CREATED&startDate=2026-06-01&endDate=2026-06-30')
      .set('Authorization', bearer(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([match['id']]);
    expect(res.body.data[0].occurredAt).toBe('2026-06-10T09:00:00.000Z');
  });
});
