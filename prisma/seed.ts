import { BillingInterval, BillingMode, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}

main().finally(() => prisma.$disconnect());
