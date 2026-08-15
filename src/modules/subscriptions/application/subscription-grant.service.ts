import { Injectable } from '@nestjs/common';
import { BillingMode, PaymentProviderKind, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { addDays, addMonths, addYears } from '../../../common/dates/date-math';

export type GrantDuration = { unit: 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME'; value: number };
export type GrantSubscriptionInput = {
  accountId: string;
  planId: string;
  duration: GrantDuration;
  billingMode: BillingMode;
  provider: PaymentProviderKind;
  status?: SubscriptionStatus;
};

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SubscriptionGrantService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: GrantSubscriptionInput, db: DbClient = this.prisma) {
    const now = new Date();
    const current = await db.subscription.findFirst({
      where: { accountId: input.accountId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
    });
    const samePlan = current?.planId === input.planId;
    const start = samePlan && current?.currentPeriodEnd && current.currentPeriodEnd > now ? current.currentPeriodEnd : now;
    const end = this.endDate(start, input.duration);
    if (current) await db.subscription.update({ where: { id: current.id }, data: { status: 'CANCELLED' } });
    const status = input.status ?? SubscriptionStatus.ACTIVE;
    return db.subscription.create({
      data: {
        accountId: input.accountId,
        planId: input.planId,
        status,
        billingMode: input.billingMode,
        provider: input.provider,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        trialEndsAt: status === SubscriptionStatus.TRIALING ? end : null,
      },
    });
  }

  private endDate(start: Date, duration: GrantDuration) {
    if (duration.unit === 'LIFETIME') return null;
    if (duration.unit === 'DAY') return addDays(start, duration.value);
    if (duration.unit === 'YEAR') return addYears(start, duration.value);
    return addMonths(start, duration.value);
  }
}
