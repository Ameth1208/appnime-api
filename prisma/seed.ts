import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';
import { seedPlans } from './seeds/plans.seed';
import { seedUsers } from './seeds/users.seed';

const connectionString = process.env.DATABASE_URL || 'postgresql://appnime:appnime@localhost:5432/appnime?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('[Seed] Starting database seeding process...');
  await seedPlans(prisma);
  await seedUsers(prisma);
  console.log('[Seed] Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('[Seed] Error during seeding:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
