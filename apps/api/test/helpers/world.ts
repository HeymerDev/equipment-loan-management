import { randomUUID } from 'node:crypto';
import {
  bindTable,
  matchesWhere,
  snapshotRow,
  type ClientMock,
  type PrismaMock,
  type Row,
} from './prisma-mock.js';
import { ADMIN, OTHER_TEACHER, TEACHER } from './auth.js';

/** Start of the UTC calendar day `offset` days from `from`. */
export function utcDay(offset: number, from: Date = new Date()): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset),
  );
}

function relate(row: Row, relations: Record<string, () => unknown>): Row {
  for (const [key, get] of Object.entries(relations)) {
    Object.defineProperty(row, key, { get, enumerable: true, configurable: true });
  }
  return row;
}

type Checkpoint = Array<{ rows: Row[]; items: Array<{ row: Row; data: Row }> }>;

/**
 * An in-memory database wired into a `PrismaMock`.
 *
 * Both the root client and the transaction client read and write the same
 * arrays, so a service sees its own writes exactly as it would against
 * Postgres. Relations (`equipment.category`, `request.teacher`,
 * `loan.request`, …) are live getters on the stored rows, and every value a
 * query returns is a detached copy, as with Prisma. Interactive transactions
 * roll back when their callback throws.
 *
 * Tests assert on the arrays directly to check the resulting state.
 */
export class World {
  readonly users: Row[] = [
    { id: ADMIN.id, email: ADMIN.email, fullName: 'Administrador de Prueba', role: 'ADMINISTRADOR' },
    { id: TEACHER.id, email: TEACHER.email, fullName: 'Docente de Prueba', role: 'DOCENTE' },
    { id: OTHER_TEACHER.id, email: OTHER_TEACHER.email, fullName: 'Otro Docente', role: 'DOCENTE' },
  ];

  readonly categories: Row[] = [
    { id: 'c0000000-0000-4000-8000-000000000001', name: 'Laptops' },
    { id: 'c0000000-0000-4000-8000-000000000002', name: 'Proyectores' },
  ];

  readonly equipment: Row[] = [];
  readonly requests: Row[] = [];
  readonly loans: Row[] = [];
  readonly events: Row[] = [];

  constructor(db: PrismaMock) {
    for (const client of [db, db.tx] as ClientMock[]) this.wire(client);

    // Interactive transactions behave like Postgres: if the callback throws,
    // every table goes back to the state it had when the transaction began.
    db.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg !== 'function') throw new Error('Unsupported $transaction argument');
      const checkpoint = this.checkpoint();
      try {
        return await (arg as (tx: ClientMock) => unknown)(db.tx);
      } catch (error) {
        this.rollback(checkpoint);
        throw error;
      }
    });
  }

  addEquipment(fields: Row = {}): Row {
    const now = new Date();
    const row: Row = {
      id: randomUUID(),
      name: 'Equipo de prueba',
      serialNumber: `SN-${randomUUID()}`,
      description: 'Equipo usado en las pruebas',
      status: 'DISPONIBLE',
      categoryId: this.categories[0]!['id'],
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    relate(row, {
      category: () => this.categories.find((c) => c['id'] === row['categoryId']),
    });
    this.equipment.push(row);
    return row;
  }

  addRequest(fields: Row & { equipmentId: unknown }): Row {
    const now = new Date();
    const row: Row = {
      id: randomUUID(),
      status: 'PENDIENTE',
      purpose: 'Clase práctica',
      startDate: utcDay(1),
      returnDate: utcDay(3),
      rejectionReason: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      teacherId: TEACHER.id,
      ...fields,
    };
    relate(row, {
      teacher: () => this.users.find((u) => u['id'] === row['teacherId']),
      equipment: () => this.equipment.find((e) => e['id'] === row['equipmentId']),
    });
    this.requests.push(row);
    return row;
  }

  addLoan(fields: Row & { equipmentId: unknown; requestId: unknown }): Row {
    const now = new Date();
    const row: Row = {
      id: randomUUID(),
      status: 'ACTIVO',
      startDate: utcDay(0),
      agreedReturnDate: utcDay(2),
      actualReturnDate: null,
      returnedLate: null,
      daysLate: null,
      returnNotes: null,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    relate(row, {
      equipment: () => this.equipment.find((e) => e['id'] === row['equipmentId']),
      request: () => this.requests.find((r) => r['id'] === row['requestId']),
    });
    this.loans.push(row);
    return row;
  }

  /** Equipment + an approved request + its ACTIVO loan, consistent with each other. */
  addActiveLoan(
    period: { startDate: Date; agreedReturnDate: Date },
    fields: { equipment?: Row; request?: Row; loan?: Row } = {},
  ): { equipment: Row; request: Row; loan: Row } {
    const equipment = this.addEquipment({ status: 'PRESTADO', ...fields.equipment });
    const request = this.addRequest({
      equipmentId: equipment['id'],
      status: 'APROBADA',
      startDate: period.startDate,
      returnDate: period.agreedReturnDate,
      ...fields.request,
    });
    const loan = this.addLoan({
      equipmentId: equipment['id'],
      requestId: request['id'],
      startDate: period.startDate,
      agreedReturnDate: period.agreedReturnDate,
      ...fields.loan,
    });
    return { equipment, request, loan };
  }

  private wire(client: ClientMock): void {
    bindTable(client.user, this.users);
    bindTable(client.category, this.categories);
    bindTable(client.equipment, this.equipment);
    bindTable(client.loanRequest, this.requests);
    bindTable(client.loan, this.loans);
    bindTable(client.historyEvent, this.events);

    client.equipment.create.mockImplementation(async ({ data }: { data: Row }) =>
      snapshotRow(this.addEquipment(data)),
    );
    client.loanRequest.create.mockImplementation(
      async ({ data }: { data: Row & { equipmentId: unknown } }) => snapshotRow(this.addRequest(data)),
    );
    client.loan.create.mockImplementation(
      async ({ data }: { data: Row & { equipmentId: unknown; requestId: unknown } }) =>
        snapshotRow(this.addLoan(data)),
    );
    client.historyEvent.create.mockImplementation(async ({ data }: { data: Row }) => {
      const row: Row = {
        id: randomUUID(),
        occurredAt: new Date(),
        changedFields: null,
        equipmentId: null,
        requestId: null,
        loanId: null,
        ...data,
      };
      this.events.push(row);
      return snapshotRow(row);
    });

    client.equipment.update.mockImplementation(
      async ({ where, data }: { where: unknown; data: Row }) => {
        const { category, ...rest } = data as Row & { category?: { connect?: { id: string } } };
        return this.patch(this.equipment, where, {
          ...rest,
          ...(category?.connect !== undefined && { categoryId: category.connect.id }),
        });
      },
    );
    client.loanRequest.update.mockImplementation(
      async ({ where, data }: { where: unknown; data: Row }) => this.patch(this.requests, where, data),
    );
    client.loan.update.mockImplementation(
      async ({ where, data }: { where: unknown; data: Row }) => this.patch(this.loans, where, data),
    );
  }

  private patch(rows: Row[], where: unknown, data: Row): Row {
    const row = rows.find((candidate) => matchesWhere(candidate, where));
    if (!row) throw new Error('World: record to update not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return snapshotRow(row);
  }

  private static ownData(row: Row): Row {
    const data: Row = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(row))) {
      if ('value' in descriptor) data[key] = descriptor.value;
    }
    return data;
  }

  private checkpoint(): Checkpoint {
    return [this.users, this.categories, this.equipment, this.requests, this.loans, this.events].map(
      (rows) => ({ rows, items: rows.map((row) => ({ row, data: World.ownData(row) })) }),
    );
  }

  private rollback(checkpoint: Checkpoint): void {
    for (const { rows, items } of checkpoint) {
      rows.length = 0;
      for (const { row, data } of items) {
        for (const key of Object.keys(World.ownData(row))) {
          if (!(key in data)) delete row[key];
        }
        Object.assign(row, data);
        rows.push(row);
      }
    }
  }
}
