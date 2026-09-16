import type { Mock } from 'vitest';
import type { PrismaMock } from './prisma-mock.js';

function mocksOf(client: object): Mock[] {
  return Object.entries(client)
    .filter(([key]) => key !== 'tx')
    .flatMap(([, value]) => {
      if (typeof value === 'function') return [value as Mock];
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).filter(
          (candidate): candidate is Mock => typeof candidate === 'function',
        );
      }
      return [];
    });
}

/**
 * Every Prisma call of any kind — reads included — inside or outside a
 * transaction. Zero means the request never touched data.
 */
export function totalCallCount(db: PrismaMock): number {
  return [...mocksOf(db), ...mocksOf(db.tx)].reduce(
    (total, mock) => total + mock.mock.calls.length,
    0,
  );
}
