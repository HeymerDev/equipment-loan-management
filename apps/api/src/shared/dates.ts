/**
 * Loans are booked and settled by calendar day, never by time of day: a request
 * reserves whole days and a return is on time as long as it happens on the
 * agreed day. These helpers put every comparison on that same footing.
 *
 * The UTC day is the reference frame so the result does not shift with the
 * server's timezone.
 */

/** Collapses a timestamp to the start of its UTC calendar day. */
export function toDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Start of the current UTC calendar day. */
export function todayStart(): Date {
  return toDayStart(new Date());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days from `from` to `to`; negative when `to` precedes `from`.
 * Both ends are collapsed to their day start first, so the result counts days
 * crossed rather than elapsed hours.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil(
    (toDayStart(to).getTime() - toDayStart(from).getTime()) / MS_PER_DAY,
  );
}
