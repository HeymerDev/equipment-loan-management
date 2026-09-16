import { vi, type Mock } from 'vitest';

/**
 * A stand-in for the Prisma client used by the unit and property suites.
 *
 * Every model delegate method is a `vi.fn()`. Interactive transactions receive
 * a *separate* client (`db.tx`), so a test can tell writes made inside the
 * transaction apart from reads made before it. Array transactions simply
 * resolve their promises.
 *
 * `bindTable` turns a delegate into a tiny in-memory table that honours the
 * `where` / `orderBy` / `skip` / `take` arguments the services send. Property
 * tests use it to check query semantics (overlaps, filters, ordering) against
 * an independent oracle instead of trusting the where clause itself.
 */

const MODELS = [
  'user',
  'refreshToken',
  'category',
  'equipment',
  'loanRequest',
  'loan',
  'historyEvent',
] as const;

const METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'create',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

const WRITE_METHODS = [
  'create',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

type Model = (typeof MODELS)[number];
type Method = (typeof METHODS)[number];

export type DelegateMock = Record<Method, Mock>;
export type ClientMock = Record<Model, DelegateMock>;

export interface PrismaMock extends ClientMock {
  $transaction: Mock;
  $disconnect: Mock;
  /** The client handed to interactive `$transaction(async (tx) => ...)` callbacks. */
  tx: ClientMock;
}

function createClient(): ClientMock {
  const client = {} as ClientMock;
  for (const model of MODELS) {
    const delegate = {} as DelegateMock;
    for (const method of METHODS) delegate[method] = vi.fn();
    client[model] = delegate;
  }
  return client;
}

function installTransaction(db: PrismaMock): void {
  db.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    if (typeof arg === 'function') {
      return (arg as (tx: ClientMock) => unknown)(db.tx);
    }
    throw new Error('Unsupported $transaction argument');
  });
}

export function createPrismaMock(): PrismaMock {
  const db = {
    ...createClient(),
    tx: createClient(),
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  } as PrismaMock;
  installTransaction(db);
  return db;
}

/** Clears every call and implementation, then restores `$transaction`. */
export function resetPrismaMock(db: PrismaMock): void {
  for (const client of [db, db.tx] as ClientMock[]) {
    for (const model of MODELS) {
      for (const method of METHODS) client[model][method].mockReset();
    }
  }
  db.$transaction.mockReset();
  installTransaction(db);
}

/** Number of write calls on any model, inside or outside a transaction. */
export function writeCallCount(db: PrismaMock): number {
  let total = 0;
  for (const client of [db, db.tx] as ClientMock[]) {
    for (const model of MODELS) {
      for (const method of WRITE_METHODS) {
        total += client[model][method].mock.calls.length;
      }
    }
  }
  return total;
}

// ── In-memory query semantics ─────────────────────────────────────────────────

export type Row = Record<string, unknown>;

const toArray = <T>(value: T | T[]): T[] =>
  Array.isArray(value) ? value : [value];

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function equals(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b);
}

/** Orders two values; `null`/`undefined` sort first, like Postgres `NULLS FIRST` on ASC. */
export function compareValues(a: unknown, b: unknown): number {
  const left = comparable(a);
  const right = comparable(b);
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return (left as number | string) < (right as number | string) ? -1 : 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

/**
 * A detached copy of a row, the way Prisma hands back a fresh object on every
 * query: relations are materialised and nothing is shared with the store, so
 * a later write cannot change a value the service read earlier.
 */
export function snapshotRow<T>(value: T, depth = 3): T {
  if (depth < 0 || !isPlainObject(value)) return value;
  const copy: Row = {};
  for (const key of Object.keys(value)) {
    copy[key] = snapshotRow((value as Row)[key], depth - 1);
  }
  return copy as T;
}

function ordered(value: unknown, arg: unknown, test: (c: number) => boolean): boolean {
  if (value === null || value === undefined) return false;
  return test(compareValues(value, arg));
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (!isPlainObject(condition)) return equals(value, condition);

  return Object.entries(condition).every(([operator, arg]) => {
    if (arg === undefined) return true;
    switch (operator) {
      case 'equals':
        return matchesField(value, arg);
      case 'not':
        return !matchesField(value, arg);
      case 'in':
        return (arg as unknown[]).some((candidate) => equals(value, candidate));
      case 'notIn':
        return !(arg as unknown[]).some((candidate) => equals(value, candidate));
      case 'lt':
        return ordered(value, arg, (c) => c < 0);
      case 'lte':
        return ordered(value, arg, (c) => c <= 0);
      case 'gt':
        return ordered(value, arg, (c) => c > 0);
      case 'gte':
        return ordered(value, arg, (c) => c >= 0);
      case 'startsWith':
        return typeof value === 'string' && value.startsWith(arg as string);
      default:
        // Fail loudly: a silently ignored operator would make a test vacuous.
        throw new Error(`prisma-mock: unsupported filter operator "${operator}"`);
    }
  });
}

/** Evaluates a flat Prisma `where` object against a row. */
export function matchesWhere(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  if (!isPlainObject(where)) throw new Error('prisma-mock: where must be an object');

  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'AND') return toArray(condition).every((w) => matchesWhere(row, w));
    if (key === 'OR') return toArray(condition).some((w) => matchesWhere(row, w));
    if (key === 'NOT') return !toArray(condition).some((w) => matchesWhere(row, w));
    return matchesField(row[key], condition);
  });
}

type OrderSpec = Record<string, 'asc' | 'desc'>;

export function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const specs = toArray<OrderSpec>(orderBy as OrderSpec | OrderSpec[]).flatMap(
    (spec) => Object.entries(spec),
  );
  return [...rows].sort((a, b) => {
    for (const [field, direction] of specs) {
      const result = compareValues(a[field], b[field]);
      if (result !== 0) return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

interface QueryArgs {
  where?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
}

export function queryRows(rows: Row[], args: QueryArgs = {}): Row[] {
  let result = rows.filter((row) => matchesWhere(row, args.where));
  if (args.orderBy !== undefined) result = sortRows(result, args.orderBy);
  const skip = args.skip ?? 0;
  return result.slice(skip, args.take === undefined ? undefined : skip + args.take);
}

/**
 * Backs a delegate with `rows`. Reads filter the live array and return
 * detached copies; `update` mutates the first matching row in place (so later
 * reads observe it). `select` is ignored — rows should already carry whatever
 * relation data the DTO needs.
 */
export function bindTable(delegate: DelegateMock, rows: Row[]): void {
  delegate.findMany.mockImplementation(async (args?: QueryArgs) =>
    queryRows(rows, args).map((row) => snapshotRow(row)),
  );
  const first = async (args?: QueryArgs) => {
    const [row] = queryRows(rows, args);
    return row === undefined ? null : snapshotRow(row);
  };
  delegate.findFirst.mockImplementation(first);
  delegate.findUnique.mockImplementation(first);
  delegate.count.mockImplementation(
    async (args?: QueryArgs) => rows.filter((row) => matchesWhere(row, args?.where)).length,
  );
  delegate.update.mockImplementation(
    async ({ where, data }: { where: unknown; data: Row }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      if (!row) throw new Error('prisma-mock: record to update not found');
      Object.assign(row, data);
      return snapshotRow(row);
    },
  );
}
