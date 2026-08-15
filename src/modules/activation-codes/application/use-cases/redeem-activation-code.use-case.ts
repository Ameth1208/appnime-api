import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingMode, PaymentProviderKind, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { sha256 } from '../../../../common/crypto/hash';
import { AccountAccessService } from '../../../accounts/account-access.service';
import { SubscriptionGrantService } from '../../../subscriptions/application/subscription-grant.service';

@Injectable()
export class RedeemActivationCodeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly grants: SubscriptionGrantService,
  ) {}

  async execute(userId: string, rawCode: string) {
    const membership = await this.access.ownerMembership(userId);
    const code = await this.prisma.activationCode.findUnique({ where: { codeHash: sha256(rawCode) } });
    if (!code || code.status !== 'AVAILABLE') throw new BadRequestException({ code: 'ACTIVATION_CODE_INVALID' });
    if (code.redemptionExpiresAt && code.redemptionExpiresAt <= new Date()) throw new BadRequestException({ code: 'ACTIVATION_CODE_EXPIRED' });
    if (code.kind === 'TRIAL') {
      const priorTrial = await this.prisma.activationRedemption.findFirst({ where: { userId, activationCode: { kind: 'TRIAL' } } });
      if (priorTrial) throw new BadRequestException({ code: 'TRIAL_ALREADY_USED' });
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.activationCode.updateMany({ where: { id: code.id, status: 'AVAILABLE' }, data: { status: 'REDEEMED', redeemedAt: new Date() } });
      if (!locked.count) throw new BadRequestException({ code: 'ACTIVATION_CODE_ALREADY_REDEEMED' });
      const subscription = await this.grants.execute({
        accountId: membership.accountId,
        planId: code.planId,
        duration: { unit: code.durationUnit, value: code.durationValue },
        billingMode: code.kind === 'LIFETIME' ? BillingMode.PERMANENT : BillingMode.CODE,
        provider: PaymentProviderKind.ACTIVATION_CODE,
        status: code.kind === 'TRIAL' ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      }, tx);
      await tx.activationRedemption.create({
        data: { activationCodeId: code.id, accountId: membership.accountId, userId, subscriptionId: subscription.id },
      });
      return { ok: true, subscription };
    });
  }
}
