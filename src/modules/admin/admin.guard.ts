import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import type { AuthPrincipal } from '../../common/security/current-user.decorator';
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const principal = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!principal) throw new ForbiddenException({ code: 'ADMIN_REQUIRED' });
    const user = await this.prisma.user.findUnique({ where: { id: principal.sub }, select: { isAdmin: true, status: true } });
    if (!user?.isAdmin || user.status !== 'ACTIVE') throw new ForbiddenException({ code: 'ADMIN_REQUIRED' });
    return true;
  }
}
