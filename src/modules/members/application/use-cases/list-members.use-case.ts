import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AccountAccessService } from '../../../accounts/account-access.service';

@Injectable()
export class ListMembersUseCase {
  constructor(private readonly prisma: PrismaService, private readonly access: AccountAccessService) {}
  async execute(userId: string) {
    const membership = await this.access.activeMembership(userId);
    return this.prisma.accountMember.findMany({
      where: { accountId: membership.accountId, status: 'ACTIVE' },
      include: { user: { select: { id: true, email: true, displayName: true, avatarObjectKey: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }
}
