import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class ReleaseUsageSessionUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(userId: string, usageSessionId: string) {
    await this.prisma.usageSession.updateMany({
      where: { id: usageSessionId, userId, status: 'ACTIVE' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    return { ok: true };
  }
}
