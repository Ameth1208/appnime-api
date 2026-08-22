import { BillingInterval, BillingMode, PrismaClient } from '@prisma/client';

const common = {
  currency: 'COP',
  maxDevicesPerUser: 3,
  maxConcurrentUsagePerUser: 1,
  maxDeviceChangesPerWindow: 6,
  deviceChangeWindowDays: 30,
  active: true,
  public: true,
};

const family = {
  ...common,
  maxDevicesPerUser: 5,
};

export const initialPlans = [
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
    ...family,
    code: 'FAMILY_MONTHLY',
    name: 'Family Mensual',
    description: 'Owner + 4 miembros, 5 dispositivos por persona, 1 uso simultaneo por persona.',
    priceCents: 2_500_000,
    billingInterval: BillingInterval.MONTH,
    billingMode: BillingMode.AUTOMATIC,
    maxAdditionalMembers: 4,
    canInviteMembers: true,
  },
  {
    ...family,
    code: 'FAMILY_YEARLY',
    name: 'Family Anual',
    description: 'Owner + 4 miembros, 5 dispositivos por persona, 1 uso simultaneo por persona.',
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
    ...family,
    public: false,
    code: 'FAMILY_LIFETIME_INTERNAL',
    name: 'Family Permanente',
    description: 'Grant interno permanente: owner + 4 miembros, 5 dispositivos por persona.',
    priceCents: 0,
    billingInterval: BillingInterval.LIFETIME,
    billingMode: BillingMode.PERMANENT,
    maxAdditionalMembers: 4,
    canInviteMembers: true,
  },
];

export async function seedPlans(prisma: PrismaClient) {
  console.log('[Seed] Seeding plans...');
  for (const plan of initialPlans) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: plan, create: plan });
  }
  console.log('[Seed] Plans seeded successfully.');
}

// Allow running directly: npx tsx prisma/seeds/plans.seed.ts
if (require.main === module) {
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { Pool } = require('pg');
  require('dotenv/config');

  const connectionString = process.env.DATABASE_URL || 'postgresql://appnime:appnime@localhost:5432/appnime?schema=public';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  seedPlans(prisma)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
