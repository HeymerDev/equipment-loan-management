// Task 4.4 — unit tests for the history writer (shared/history.service.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventType, type Prisma } from '@prisma/client';

vi.mock('../../src/config/prisma.js', async () => {
  const { createPrismaMock } = await import('../helpers/prisma-mock.js');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/config/prisma.js';
import { HistoryService } from '../../src/shared/history.service.js';
import { resetPrismaMock, type PrismaMock } from '../helpers/prisma-mock.js';

const db = prisma as unknown as PrismaMock;
const service = new HistoryService();
const tx = db.tx as unknown as Prisma.TransactionClient;

const base = {
  entityId: 'e0000000-0000-4000-8000-000000000001',
  entityTable: 'Equipment',
  userId: 'a0000000-0000-4000-8000-000000000001',
};

beforeEach(() => {
  resetPrismaMock(db);
  db.historyEvent.create.mockResolvedValue({});
  db.tx.historyEvent.create.mockResolvedValue({});
});

describe('HistoryService.record', () => {
  it('knows exactly the event types the requirements define (plus equipment deletion)', () => {
    expect(Object.values(EventType).sort()).toEqual(
      [
        'EQUIPMENT_CREATED',
        'EQUIPMENT_UPDATED',
        'EQUIPMENT_DELETED',
        'REQUEST_CREATED',
        'REQUEST_APPROVED',
        'REQUEST_REJECTED',
        'REQUEST_CANCELLED',
        'LOAN_STARTED',
        'LOAN_RETURNED',
      ].sort(),
    );
  });

  it.each(Object.values(EventType))('records %s with its type, entity and author', async (eventType) => {
    await service.record({ ...base, eventType });

    expect(db.historyEvent.create).toHaveBeenCalledTimes(1);
    expect(db.historyEvent.create).toHaveBeenCalledWith({ data: { eventType, ...base } });
  });

  it('stores the before and after value of every changed field', async () => {
    const changedFields = [
      { field: 'name', before: 'Laptop A', after: 'Laptop B' },
      { field: 'categoryId', before: 'c-1', after: 'c-2' },
      { field: 'rejectionReason', before: null, after: 'Equipo en mantenimiento' },
    ];

    await service.record({ ...base, eventType: 'EQUIPMENT_UPDATED', changedFields });

    const { data } = db.historyEvent.create.mock.calls[0]![0];
    expect(data.changedFields).toEqual(changedFields);
  });

  it('omits changedFields when the event has none, so the column stays null', async () => {
    await service.record({ ...base, eventType: 'EQUIPMENT_CREATED' });

    const { data } = db.historyEvent.create.mock.calls[0]![0];
    expect(data).not.toHaveProperty('changedFields');
  });

  it('links the equipment, request and loan only when they are given', async () => {
    await service.record({
      ...base,
      eventType: 'LOAN_STARTED',
      equipmentId: 'eq-1',
      requestId: 'rq-1',
      loanId: 'ln-1',
    });
    await service.record({ ...base, eventType: 'EQUIPMENT_CREATED', equipmentId: 'eq-2' });

    const [first, second] = db.historyEvent.create.mock.calls.map((call) => call[0].data);
    expect(first).toMatchObject({ equipmentId: 'eq-1', requestId: 'rq-1', loanId: 'ln-1' });
    expect(second).toMatchObject({ equipmentId: 'eq-2' });
    expect(second).not.toHaveProperty('requestId');
    expect(second).not.toHaveProperty('loanId');
  });

  it('leaves the timestamp to the database default', async () => {
    await service.record({ ...base, eventType: 'REQUEST_CREATED' });

    const { data } = db.historyEvent.create.mock.calls[0]![0];
    expect(data).not.toHaveProperty('occurredAt');
  });

  it('writes through the transaction client when one is given', async () => {
    await service.record({ ...base, eventType: 'REQUEST_APPROVED', tx });

    expect(db.tx.historyEvent.create).toHaveBeenCalledTimes(1);
    expect(db.historyEvent.create).not.toHaveBeenCalled();
    expect(db.tx.historyEvent.create.mock.calls[0]![0].data).not.toHaveProperty('tx');
  });

  it('propagates a failed write so the surrounding transaction rolls back', async () => {
    db.tx.historyEvent.create.mockRejectedValue(new Error('foreign key violation'));

    await expect(service.record({ ...base, eventType: 'LOAN_RETURNED', tx })).rejects.toThrow(
      'foreign key violation',
    );
  });

  it('offers no way to modify or delete an entry', () => {
    const methods = Object.getOwnPropertyNames(HistoryService.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual(['record']);
  });
});
