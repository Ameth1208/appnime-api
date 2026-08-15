import { BillingInterval, BillingMode, PrismaClient, SubscriptionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hash } from 'argon2';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL || 'postgresql://appnime:appnime@localhost:5432/appnime?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const common = {
  currency: 'COP',
  maxDevicesPerUser: 3,
  maxConcurrentUsagePerUser: 1,
  maxDeviceChangesPerWindow: 6,
  deviceChangeWindowDays: 30,
  active: true,
  public: true,
};

async function main() {
  const plans = [
    {
      ...common,
      code: 'INDIVIDUAL_MONTHLY',
      name: 'Individual Mensual',
      description: '1 persona, 3 dispositivos registrados, 1 uso simultaneo.',
      priceCents: 1_600_000,
      billingInterval: BillingInterval.MONTH,
      billingMode: BillingMode.AUTOMATIC,
      maxAdditionalMembers: 0,
      canInviteMembers: false,
    },
    {
      ...common,
      code: 'INDIVIDUAL_YEARLY',
      name: 'Individual Anual',
      description: '1 persona, 3 dispositivos registrados, 1 uso simultaneo.',
      priceCents: 16_000_000,
      billingInterval: BillingInterval.YEAR,
      billingMode: BillingMode.AUTOMATIC,
      maxAdditionalMembers: 0,
      canInviteMembers: false,
    },
    {
      ...common,
      code: 'FAMILY_MONTHLY',
      name: 'Family Mensual',
      description: 'Owner + 4 miembros, 3 dispositivos por persona, 1 uso simultaneo por persona.',
      priceCents: 2_500_000,
      billingInterval: BillingInterval.MONTH,
      billingMode: BillingMode.AUTOMATIC,
      maxAdditionalMembers: 4,
      canInviteMembers: true,
    },
    {
      ...common,
      code: 'FAMILY_YEARLY',
      name: 'Family Anual',
      description: 'Owner + 4 miembros, 3 dispositivos por persona, 1 uso simultaneo por persona.',
      priceCents: 25_000_000,
      billingInterval: BillingInterval.YEAR,
      billingMode: BillingMode.AUTOMATIC,
      maxAdditionalMembers: 4,
      canInviteMembers: true,
    },

    {
      ...common,
      public: false,
      code: 'INDIVIDUAL_LIFETIME_INTERNAL',
      name: 'Individual Permanente',
      description: 'Grant interno permanente: 1 persona, 3 dispositivos, 1 uso simultaneo.',
      priceCents: 0,
      billingInterval: BillingInterval.LIFETIME,
      billingMode: BillingMode.PERMANENT,
      maxAdditionalMembers: 0,
      canInviteMembers: false,
    },
    {
      ...common,
      public: false,
      code: 'FAMILY_LIFETIME_INTERNAL',
      name: 'Family Permanente',
      description: 'Grant interno permanente: owner + 4 miembros, 3 dispositivos por persona.',
      priceCents: 0,
      billingInterval: BillingInterval.LIFETIME,
      billingMode: BillingMode.PERMANENT,
      maxAdditionalMembers: 4,
      canInviteMembers: true,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: plan, create: plan });
  }

  // Create Initial Super Admin User
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

    console.log(`[Seed] Super Admin user created successfully: ${adminEmail}`);
  } else {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { isAdmin: true },
    });
    console.log(`[Seed] Existing user ${adminEmail} updated to Super Admin.`);
  }

  // Create Initial Demo Standard User
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

    console.log(`[Seed] Standard demo user created successfully: ${demoEmail}`);
  } else {
    console.log(`[Seed] Standard demo user ${demoEmail} already exists.`);
  }
}

main().finally(() => prisma.$disconnect());
