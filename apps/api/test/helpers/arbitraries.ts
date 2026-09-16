import fc from 'fast-check';
import { utcDay } from './world.js';

/** Non-blank printable text of at most `maxLength` chars, already trimmed. */
export const textArb = (maxLength: number) =>
  fc
    .string({ unit: 'grapheme-ascii', minLength: 1, maxLength })
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const equipmentInputArb = fc.record({
  name: textArb(100),
  serialNumber: textArb(50),
  description: textArb(500),
  categoryId: fc.uuid(),
});

export interface Period {
  startDate: Date;
  endDate: Date;
}

/**
 * A day-aligned period starting `minStart..maxStart` days from today and
 * lasting 1..`maxLength` days.
 */
export const periodArb = (
  { minStart, maxStart, maxLength = 20 }: { minStart: number; maxStart: number; maxLength?: number },
): fc.Arbitrary<Period> =>
  fc
    .tuple(fc.integer({ min: minStart, max: maxStart }), fc.integer({ min: 1, max: maxLength }))
    .map(([start, length]) => ({ startDate: utcDay(start), endDate: utcDay(start + length) }));

/** Independent oracle: do two inclusive day ranges share at least one day? */
export function overlaps(a: Period, b: Period): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
