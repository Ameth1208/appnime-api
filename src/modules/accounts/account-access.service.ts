import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
@Injectable()
export class AccountAccessService {
  constructor(private readonly prisma: PrismaService) {}
  async activeMembership(userId: string) {
    const membership = await this.prisma.accountMember.findFirst({ where: { userId, status: 'ACTIVE' }, include: { account: true } });
    if (!membership || membership.account.status !== 'ACTIVE') throw new ForbiddenException({ code: 'ACCOUNT_ACCESS_DENIED' });
    return membership;
  }
  async ownerMembership(userId: string) {
    const m = await this.activeMembership(userId);
    if (m.role !== 'OWNER') throw new ForbiddenException({ code: 'OWNER_REQUIRED' });
    return m;
  }
}
