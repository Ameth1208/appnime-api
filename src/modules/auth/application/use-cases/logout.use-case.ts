import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class LogoutUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }
}
