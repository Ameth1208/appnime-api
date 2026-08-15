import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class HeartbeatUsageSessionUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(userId: string, usageSessionId: string) {
    const result = await this.prisma.usageSession.updateMany({
      where: { id: usageSessionId, userId, status: 'ACTIVE' },
      data: { lastHeartbeatAt: new Date() },
    });
    if (!result.count) throw new BadRequestException({ code: 'USAGE_SESSION_NOT_ACTIVE' });
    return { ok: true };
  }
}
