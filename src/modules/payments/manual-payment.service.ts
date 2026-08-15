import { Injectable } from '@nestjs/common';
import { BillingMode, PaymentProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { SubscriptionGrantService } from '../subscriptions/application/subscription-grant.service';

@Injectable()
export class ManualPaymentService {
  constructor(private readonly prisma: PrismaService, private readonly grants: SubscriptionGrantService) {}
  async record(input: { accountId: string; planId: string; amountCents: number; reference?: string; adminUserId?: string }) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
    const duration = plan.billingInterval === 'YEAR'
      ? { unit: 'YEAR' as const, value: 1 }
      : plan.billingInterval === 'LIFETIME'
        ? { unit: 'LIFETIME' as const, value: 1 }
        : { unit: 'MONTH' as const, value: 1 };
    return this.prisma.$transaction(async (tx) => {
      const subscription = await this.grants.execute({
        accountId: input.accountId,
        planId: input.planId,
        duration,
        billingMode: plan.billingInterval === 'LIFETIME' ? BillingMode.PERMANENT : BillingMode.MANUAL,
        provider: PaymentProviderKind.MANUAL,
      }, tx);
      const payment = await tx.payment.create({
        data: {
          accountId: input.accountId,
          subscriptionId: subscription.id,
          amountCents: input.amountCents,
          currency: plan.currency,
          provider: 'MANUAL',
          providerPaymentId: input.reference,
          status: 'PAID',
          paidAt: new Date(),
          metadata: input.adminUserId ? { adminUserId: input.adminUserId } : undefined,
        },
      });
      return { subscription, payment };
    });
  }
}
