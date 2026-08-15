import { Injectable } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';
import { addHours } from '../../common/dates/date-math';

@Injectable()
export class SubscriptionPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async resolve(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { status: true } });
    if (!account || account.status !== 'ACTIVE') return { active: false as const, reason: 'ACCOUNT_NOT_ACTIVE' as const };
    const subscription = await this.prisma.subscription.findFirst({
      where: { accountId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return { active: false as const, reason: 'NO_SUBSCRIPTION' as const };
    if (subscription.billingMode === 'PERMANENT' || subscription.plan.billingInterval === BillingInterval.LIFETIME) {
      return { active: true as const, subscription, plan: subscription.plan, accessValidUntil: null };
    }

    const baseEnd = subscription.status === SubscriptionStatus.TRIALING
      ? subscription.trialEndsAt ?? subscription.currentPeriodEnd
      : subscription.currentPeriodEnd;
    if (!baseEnd) return { active: false as const, reason: 'INVALID_PERIOD' as const, subscription };

    const isTrial = subscription.status === SubscriptionStatus.TRIALING;
    const accessValidUntil = isTrial
      ? baseEnd
      : addHours(baseEnd, Number(this.config.get('PAYMENT_GRACE_HOURS', 48)));
    const now = new Date();

    if (accessValidUntil <= now) {
      await this.prisma.subscription.updateMany({ where: { id: subscription.id, status: { not: 'EXPIRED' } }, data: { status: 'EXPIRED' } });
      return { active: false as const, reason: 'EXPIRED' as const, subscription, accessValidUntil };
    }
    if (!isTrial && baseEnd <= now && subscription.status !== SubscriptionStatus.PAST_DUE) {
      await this.prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } });
      subscription.status = SubscriptionStatus.PAST_DUE;
    }
    return { active: true as const, subscription, plan: subscription.plan, accessValidUntil };
  }
}
