import { BillingMode, PrismaClient, SubscriptionStatus } from '@prisma/client';
import { hash } from 'argon2';

export async function seedUsers(prisma: PrismaClient) {
  console.log('[Seed] Seeding initial users...');

  // 1. Initial Super Admin User
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@appnime.com';
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Admin123456!';

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const passwordHash = await hash(adminPassword);
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        displayName: 'Super Admin',
        passwordHash,
        isAdmin: true,
        adminRole: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const account = await prisma.account.create({
      data: {
        ownerUserId: adminUser.id,
        status: 'ACTIVE',
      },
    });

    await prisma.accountMember.create({
      data: {
        accountId: account.id,
        userId: adminUser.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    const familyLifetimePlan = await prisma.plan.findUnique({ where: { code: 'FAMILY_LIFETIME_INTERNAL' } });
    if (familyLifetimePlan) {
      await prisma.subscription.create({
        data: {
          accountId: account.id,
          planId: familyLifetimePlan.id,
          status: SubscriptionStatus.ACTIVE,
          billingMode: BillingMode.PERMANENT,
          provider: 'MANUAL',
        },
      });
    }

    console.log(`[Seed] Super Admin user created: ${adminEmail}`);
  } else {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { isAdmin: true },
    });
    console.log(`[Seed] Existing user ${adminEmail} updated to Super Admin.`);
  }

  // 2. Initial Standard Demo User
  const demoEmail = process.env.INITIAL_USER_EMAIL || 'user@appnime.com';
  const demoPassword = process.env.INITIAL_USER_PASSWORD || 'User123456!';

  const existingDemoUser = await prisma.user.findUnique({ where: { email: demoEmail } });

  if (!existingDemoUser) {
    const passwordHash = await hash(demoPassword);
    const demoUser = await prisma.user.create({
      data: {
        email: demoEmail,
        displayName: 'Usuario AppNime',
        passwordHash,
        isAdmin: false,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const account = await prisma.account.create({
      data: {
        ownerUserId: demoUser.id,
        status: 'ACTIVE',
      },
    });

    await prisma.accountMember.create({
      data: {
        accountId: account.id,
        userId: demoUser.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    const individualPlan = await prisma.plan.findUnique({ where: { code: 'INDIVIDUAL_MONTHLY' } });
    if (individualPlan) {
      const now = new Date();
      const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: {
          accountId: account.id,
          planId: individualPlan.id,
          status: SubscriptionStatus.ACTIVE,
          billingMode: BillingMode.AUTOMATIC,
          provider: 'MANUAL',
          currentPeriodStart: now,
          currentPeriodEnd: nextMonth,
        },
      });
    }

    console.log(`[Seed] Standard demo user created: ${demoEmail}`);
  } else {
    console.log(`[Seed] Standard demo user ${demoEmail} already exists.`);
  }

  console.log('[Seed] Users seeded successfully.');
}

// Allow running directly: npx tsx prisma/seeds/users.seed.ts
if (require.main === module) {
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { Pool } = require('pg');
  require('dotenv/config');

  const connectionString = process.env.DATABASE_URL || 'postgresql://appnime:appnime@localhost:5432/appnime?schema=public';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  seedUsers(prisma)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
