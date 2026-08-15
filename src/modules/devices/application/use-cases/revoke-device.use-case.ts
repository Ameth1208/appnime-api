import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class RevokeDeviceUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId, status: 'ACTIVE' } });
    if (!device) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id: device.id }, data: { status: 'REVOKED', revokedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { deviceId: device.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.usageSession.updateMany({ where: { deviceId: device.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } }),
      this.prisma.deviceChange.create({ data: { accountId: device.accountId, userId, deviceId: device.id, action: 'REVOKED' } }),
    ]);
    return { ok: true };
  }
}
