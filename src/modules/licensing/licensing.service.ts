import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, addHours } from '../../common/dates/date-math';
import { AccountAccessService } from '../accounts/account-access.service';
import { SubscriptionPolicyService } from '../subscriptions/subscription-policy.service';
import { LeaseKeyService } from './lease-key.service';

@Injectable()
export class LicensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly policy: SubscriptionPolicyService,
    private readonly keys: LeaseKeyService,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, deviceId: string) {
    const membership = await this.access.activeMembership(userId);
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, accountId: membership.accountId, userId, status: 'ACTIVE' } });
    if (!device) throw new ForbiddenException({ code: 'DEVICE_NOT_AUTHORIZED' });
    const entitlement = await this.policy.resolve(membership.accountId);
    if (!entitlement.active) throw new ForbiddenException({ code: entitlement.reason });
    const now = new Date();
    const refreshAfter = addHours(now, Number(this.config.get('LEASE_REFRESH_AFTER_HOURS', 6)));
    const subscriptionValidUntil = entitlement.accessValidUntil ?? null;
    const offlineBase = subscriptionValidUntil ?? addDays(now, 30);
    const offlineGraceUntil = addHours(offlineBase, Number(this.config.get('OFFLINE_GRACE_HOURS', 72)));
    const tokenId = randomUUID();
    await this.prisma.accessLease.create({
      data: { accountId: membership.accountId, userId, deviceId, subscriptionValidUntil, refreshAfter, offlineGraceUntil, tokenId },
    });
    const token = await this.keys.sign({
      typ: 'appnime-access-lease',
      jti: tokenId,
      sub: userId,
      accountId: membership.accountId,
      deviceId,
      planCode: entitlement.plan.code,
      refreshAfter: refreshAfter.toISOString(),
      subscriptionValidUntil: subscriptionValidUntil?.toISOString() ?? null,
      offlineGraceUntil: offlineGraceUntil.toISOString(),
    }, offlineGraceUntil);
    return { token, issuedAt: now, refreshAfter, offlineGraceUntil, subscriptionValidUntil };
  }
}
