import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AccountAccessService } from '../../../accounts/account-access.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';

@Injectable()
export class RemoveMemberUseCase {
  constructor(private readonly prisma: PrismaService, private readonly access: AccountAccessService, private readonly realtime: RealtimeGateway) {}
  async execute(ownerId: string, memberUserId: string) {
    const owner = await this.access.ownerMembership(ownerId);
    const member = await this.prisma.accountMember.findFirst({ where: { accountId: owner.accountId, userId: memberUserId, role: 'MEMBER', status: 'ACTIVE' } });
    if (!member) throw new BadRequestException({ code: 'MEMBER_NOT_FOUND' });
    const devices = await this.prisma.device.findMany({ where: { accountId: owner.accountId, userId: memberUserId, status: 'ACTIVE' }, select: { id: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.accountMember.update({ where: { id: member.id }, data: { status: 'REMOVED', removedAt: new Date() } });
      await tx.device.updateMany({ where: { id: { in: devices.map((item) => item.id) } }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await tx.session.updateMany({ where: { userId: memberUserId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.usageSession.updateMany({ where: { userId: memberUserId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      const personalAccount = await tx.account.create({ data: { ownerUserId: memberUserId } });
      await tx.accountMember.create({ data: { accountId: personalAccount.id, userId: memberUserId, role: 'OWNER', status: 'ACTIVE' } });
    });
    this.realtime.emitUser(memberUserId, 'member.removed', { accountId: owner.accountId });
    return { ok: true };
  }
}
