import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Categories ──────────────────────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { name: 'Laptops' },
      update: {},
      create: { name: 'Laptops' },
    }),
    prisma.category.upsert({
      where: { name: 'Proyectores' },
      update: {},
      create: { name: 'Proyectores' },
    }),
    prisma.category.upsert({
      where: { name: 'Tablets' },
      update: {},
      create: { name: 'Tablets' },
    }),
  ]);

  console.log(`✅ Created ${categories.length} categories`);

  // ── Users ───────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@school.com' },
    update: {},
    create: {
      email: 'admin@school.com',
      passwordHash,
      fullName: 'Administrador Principal',
      role: Role.ADMINISTRADOR,
    },
  });

  const teacher = await prisma.user.upsert({
    where: { email: 'docente@school.com' },
    update: {},
    create: {
      email: 'docente@school.com',
      passwordHash,
      fullName: 'Docente Ejemplo',
      role: Role.DOCENTE,
    },
  });

  console.log(`✅ Created users: ${admin.email}, ${teacher.email}`);
  console.log('');
  console.log('📋 Seed credentials:');
  console.log('  Admin   → admin@school.com   / password123');
  console.log('  Docente → docente@school.com / password123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
