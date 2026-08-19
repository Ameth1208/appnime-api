import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import type { AuthPrincipal } from '../../common/security/current-user.decorator';

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  RESELLER = 'RESELLER',
}

/**
 * Guard que verifica que el usuario sea admin.
 * Jerarquía: SUPER_ADMIN > ADMIN > RESELLER
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const principal = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!principal) throw new ForbiddenException({ code: 'ADMIN_REQUIRED' });

    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      select: { isAdmin: true, adminRole: true, permissions: true, status: true },
    });
    if (!user?.isAdmin || user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED' });
    }

    // Almacenar el rol y permisos en el request para controladores.
    const request = context.switchToHttp().getRequest();
    request.adminRole = user.adminRole ?? AdminRole.ADMIN;
    request.permissions = user.permissions ?? [];

    return true;
  }
}

/**
 * Guard específico para acciones que solo SUPER_ADMIN puede ejecutar
 * (gestión de otros administradores, configuraciones financieras y auditoría).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const principal = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!principal) throw new ForbiddenException({ code: 'SUPER_ADMIN_REQUIRED' });

    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      select: { isAdmin: true, adminRole: true, permissions: true, status: true },
    });
    if (!user?.isAdmin || user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'SUPER_ADMIN_REQUIRED' });
    }
    if (user.adminRole !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException({ code: 'SUPER_ADMIN_REQUIRED' });
    }

    const request = context.switchToHttp().getRequest();
    request.adminRole = user.adminRole;
    request.permissions = user.permissions ?? [];

    return true;
  }
}
