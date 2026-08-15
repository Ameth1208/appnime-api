import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { sha256 } from '../../../../common/crypto/hash';
import { RegisterDeviceUseCase } from '../../../devices/application/use-cases/register-device.use-case';
import { requestDeviceLinkSchema } from '../../device-link.schemas';

@Injectable()
export class ApproveDeviceLinkUseCase {
  constructor(private readonly prisma: PrismaService, private readonly registerDevice: RegisterDeviceUseCase) {}
  async execute(userId: string, rawCode: string) {
    const link = await this.prisma.deviceLink.findUnique({ where: { codeHash: sha256(rawCode) } });
    if (!link || link.status !== 'PENDING' || link.expiresAt <= new Date()) throw new BadRequestException({ code: 'DEVICE_LINK_INVALID_OR_EXPIRED' });
    const deviceInput = requestDeviceLinkSchema.parse(link.devicePayload);
    const device = await this.registerDevice.execute(userId, deviceInput);
    await this.prisma.deviceLink.update({
      where: { id: link.id },
      data: { status: 'APPROVED', approvedByUserId: userId, accountId: device.accountId, deviceId: device.id, approvedAt: new Date() },
    });
    return { ok: true, device: { id: device.id, deviceName: device.deviceName, model: device.model, platform: device.platform } };
  }
}
