import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../common/database/prisma.service';
import { TokenService } from '../../token.service';

@Injectable()
export class CreateAuthSessionUseCase {
  constructor(private readonly prisma: PrismaService, private readonly tokens: TokenService, private readonly config: ConfigService) {}
  async execute(user: { id: string; email: string }, deviceId?: string | null) {
    const ttl = Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS', 2_592_000));
    const session = await this.prisma.session.create({
      data: { userId: user.id, deviceId: deviceId ?? null, expiresAt: new Date(Date.now() + ttl * 1000), refreshTokenHash: 'pending' },
    });
    const pair = await this.tokens.issue(user, session.id, deviceId);
    await this.prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: this.tokens.hashRefresh(pair.refreshToken) } });
    return { ...pair, sessionId: session.id };
  }
}
