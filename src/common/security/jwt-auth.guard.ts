import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import type { AuthPrincipal } from './current-user.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const raw = String(request.headers.authorization ?? '');
    if (!raw.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'TOKEN_REQUIRED' });
    try {
      const principal = await this.jwt.verifyAsync<AuthPrincipal>(raw.slice(7), {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      const session = await this.prisma.session.findUnique({
        where: { id: principal.sessionId },
        include: { user: { select: { status: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
        throw new Error('inactive');
      }
      request.user = principal;
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_OR_REVOKED_TOKEN' });
    }
  }
}
