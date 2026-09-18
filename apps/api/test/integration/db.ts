import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Category, Role, User } from '@prisma/client';
import { prisma } from '../../src/config/prisma.js';
import { app } from '../../src/app.js';

/**
 * Tag for everything one integration file creates. Serial numbers, category
 * names and e-mails start with it, so `cleanup` can remove exactly this run's
 * rows even from a database that also holds other data.
 */
export const RUN = `INT-${randomUUID().slice(0, 8)}`;
const EMAIL_PREFIX = RUN.toLowerCase();

export const PASSWORD = 'password123';

export interface Fixtures {
  category: Category;
  admin: User;
  teacher: User;
  otherTeacher: User;
}

export async function createUser(label: string, role: Role, fullName = `Usuario ${label}`): Promise<User> {
  return prisma.user.create({
    data: {
      email: `${EMAIL_PREFIX}-${label}@test.local`,
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      fullName,
      role,
    },
  });
}

export async function createFixtures(): Promise<Fixtures> {
  const category = await prisma.category.create({ data: { name: `${RUN} Categoría` } });
  const [admin, teacher, otherTeacher] = await Promise.all([
    createUser('admin', 'ADMINISTRADOR', 'Administrador de Integración'),
    createUser('teacher', 'DOCENTE', 'Docente de Integración'),
    createUser('other', 'DOCENTE', 'Otro Docente de Integración'),
  ]);
  return { category, admin, teacher, otherTeacher };
}

/** A serial number unique to this run (at most 34 characters). */
export const serial = (label: string): string =>
  `${RUN}-${label.slice(0, 12)}-${randomUUID().slice(0, 8)}`;

export async function login(user: User): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status}`);
  return res.body.data.accessToken as string;
}

/** Deletes every row tagged with this run, children first. */
export async function cleanup(): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const equipment = await prisma.equipment.findMany({
      where: { serialNumber: { startsWith: RUN } },
      select: { id: true },
    });
    const equipmentIds = equipment.map((e) => e.id);

    await prisma.historyEvent.deleteMany({
      where: { OR: [{ equipmentId: { in: equipmentIds } }, { userId: { in: userIds } }] },
    });
    await prisma.loan.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
    await prisma.loanRequest.deleteMany({
      where: { OR: [{ equipmentId: { in: equipmentIds } }, { teacherId: { in: userIds } }] },
    });
    await prisma.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
    await prisma.category.deleteMany({ where: { name: { startsWith: RUN } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Rows left behind by this run — should be zero after `cleanup`. */
export async function leftovers(): Promise<number> {
  const [equipment, users, categories] = await Promise.all([
    prisma.equipment.count({ where: { serialNumber: { startsWith: RUN } } }),
    prisma.user.count({ where: { email: { startsWith: EMAIL_PREFIX } } }),
    prisma.category.count({ where: { name: { startsWith: RUN } } }),
  ]);
  return equipment + users + categories;
}
