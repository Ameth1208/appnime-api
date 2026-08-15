import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../common/database/prisma.service';
import { SubscriptionPolicyService } from '../../../subscriptions/subscription-policy.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';

@Injectable()
export class AcquireUsageSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SubscriptionPolicyService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  async execute(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId, status: 'ACTIVE' } });
    if (!device) throw new BadRequestException({ code: 'DEVICE_NOT_AUTHORIZED' });
    const entitlement = await this.policy.resolve(device.accountId);
    if (!entitlement.active) throw new BadRequestException({ code: entitlement.reason });
    const staleSeconds = Number(this.config.get('USAGE_SESSION_STALE_SECONDS', 180));
    const staleBefore = new Date(Date.now() - staleSeconds * 1000);
    const previous = await this.prisma.usageSession.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, deviceId: true, lastHeartbeatAt: true },
    });
    const previousActive = previous.filter((item) => item.deviceId !== deviceId && item.lastHeartbeatAt >= staleBefore);
    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.usageSession.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now },
      });
      return tx.usageSession.create({ data: { userId, deviceId, status: 'ACTIVE', acquiredAt: now, lastHeartbeatAt: now } });
    });
    for (const session of previousActive) {
      this.realtime.emitDevice(session.deviceId, 'usage.session.revoked', {
        reason: 'USED_ON_ANOTHER_DEVICE',
        replacementDeviceId: deviceId,
      });
    }
    return created;
  }
}
