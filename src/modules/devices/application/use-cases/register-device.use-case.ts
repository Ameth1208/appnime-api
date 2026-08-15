import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AccountAccessService } from '../../../accounts/account-access.service';
import { SubscriptionPolicyService } from '../../../subscriptions/subscription-policy.service';
import { DeviceFingerprintService } from '../../device-fingerprint.service';
import { RegisterDeviceInput } from '../../device.schemas';

@Injectable()
export class RegisterDeviceUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly policy: SubscriptionPolicyService,
    private readonly fingerprint: DeviceFingerprintService,
  ) {}

  async execute(userId: string, input: RegisterDeviceInput) {
    const membership = await this.access.activeMembership(userId);
    const entitlement = await this.policy.resolve(membership.accountId);
    if (!entitlement.active) throw new BadRequestException({ code: entitlement.reason });
    const existing = await this.prisma.device.findUnique({
      where: { accountId_installationId: { accountId: membership.accountId, installationId: input.installationId } },
    });
    if (existing) {
      if (existing.userId !== userId) throw new BadRequestException({ code: 'DEVICE_BELONGS_TO_ANOTHER_MEMBER' });
      return this.prisma.device.update({
        where: { id: existing.id },
        data: this.deviceUpdate(input),
      });
    }
    const activeCount = await this.prisma.device.count({ where: { userId, accountId: membership.accountId, status: 'ACTIVE' } });
    if (activeCount >= entitlement.plan.maxDevicesPerUser) {
      throw new BadRequestException({ code: 'USER_DEVICE_LIMIT_REACHED', maxDevices: entitlement.plan.maxDevicesPerUser });
    }
    await this.enforceReplacementWindow(userId, membership.accountId, entitlement.plan.maxDeviceChangesPerWindow, entitlement.plan.deviceChangeWindowDays);
    const device = await this.prisma.device.create({
      data: {
        accountId: membership.accountId,
        userId,
        installationId: input.installationId,
        platform: input.platform,
        brand: input.brand,
        model: input.model,
        deviceName: input.deviceName,
        architecture: input.architecture,
        osVersion: input.osVersion,
        appVersion: input.appVersion,
        deviceFingerprintHash: this.fingerprint.hash(input.fingerprint),
        macHash: this.fingerprint.hash(input.mac),
      },
    });
    await this.prisma.deviceChange.create({ data: { accountId: membership.accountId, userId, deviceId: device.id, action: 'REGISTERED' } });
    return device;
  }

  private deviceUpdate(input: RegisterDeviceInput) {
    return {
      status: 'ACTIVE' as const,
      revokedAt: null,
      lastSeenAt: new Date(),
      platform: input.platform,
      brand: input.brand,
      model: input.model,
      deviceName: input.deviceName,
      architecture: input.architecture,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      deviceFingerprintHash: this.fingerprint.hash(input.fingerprint),
      macHash: this.fingerprint.hash(input.mac),
    };
  }

  private async enforceReplacementWindow(userId: string, accountId: string, max: number, windowDays: number) {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const changes = await this.prisma.deviceChange.count({ where: { userId, accountId, action: 'REVOKED', createdAt: { gte: since } } });
    if (changes >= max) throw new BadRequestException({ code: 'DEVICE_CHANGE_LIMIT_REACHED', maxChanges: max, windowDays });
  }
}
