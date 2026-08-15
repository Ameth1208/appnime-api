import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { PrismaService } from '../../common/database/prisma.service';
import { AccountAccessService } from './account-access.service';

@Controller('v1/account')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly access: AccountAccessService, private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: AuthPrincipal) {
    const membership = await this.access.activeMembership(user.sub);
    return this.prisma.account.findUniqueOrThrow({
      where: { id: membership.accountId },
      include: {
        members: {
          where: { status: 'ACTIVE' },
          include: { user: { select: { id: true, email: true, displayName: true, avatarObjectKey: true } } },
        },
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        devices: { where: { status: 'ACTIVE' } },
      },
    });
  }
}
