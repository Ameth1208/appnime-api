import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { TokenService } from '../../token.service';

@Injectable()
export class RefreshSessionUseCase {
  constructor(private readonly prisma: PrismaService, private readonly tokens: TokenService) {}
  async execute(raw: string) {
    const payload = await this.tokens.verifyRefresh(raw).catch(() => { throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN' }); });
    const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    }
    if (session.refreshTokenHash !== this.tokens.hashRefresh(raw)) {
      await this.prisma.session.updateMany({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REUSED' });
    }
    const pair = await this.tokens.issue(session.user, session.id, session.deviceId);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.tokens.hashRefresh(pair.refreshToken), lastUsedAt: new Date() },
    });
    return pair;
  }
}
