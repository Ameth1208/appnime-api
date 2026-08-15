import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { sha256 } from '../../../../common/crypto/hash';

@Injectable()
export class AcceptInvitationUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw new BadRequestException({ code: 'INVITATION_INVALID_OR_EXPIRED' });
    }
    if (invitation.email !== user.email) throw new BadRequestException({ code: 'INVITATION_EMAIL_MISMATCH' });
    const current = await this.prisma.accountMember.findFirst({ where: { userId, status: 'ACTIVE' }, include: { account: true } });
    if (current && current.accountId !== invitation.accountId) await this.ensureCurrentAccountCanBeClosed(current.accountId, userId, current.role);
    await this.prisma.$transaction(async (tx) => {
      if (current && current.accountId !== invitation.accountId) {
        await tx.accountMember.update({ where: { id: current.id }, data: { status: 'REMOVED', removedAt: new Date() } });
        if (current.role === 'OWNER') await tx.account.update({ where: { id: current.accountId }, data: { status: 'CLOSED' } });
      }
      await tx.accountMember.upsert({
        where: { accountId_userId: { accountId: invitation.accountId, userId } },
        update: { role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date(), removedAt: null },
        create: { accountId: invitation.accountId, userId, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    });
    return { ok: true, accountId: invitation.accountId };
  }

  private async ensureCurrentAccountCanBeClosed(accountId: string, userId: string, role: string) {
    if (role !== 'OWNER') throw new BadRequestException({ code: 'USER_ALREADY_IN_ANOTHER_ACCOUNT' });
    const [subscriptions, devices, otherMembers] = await Promise.all([
      this.prisma.subscription.count({ where: { accountId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } }),
      this.prisma.device.count({ where: { accountId, status: 'ACTIVE' } }),
      this.prisma.accountMember.count({ where: { accountId, userId: { not: userId }, status: 'ACTIVE' } }),
    ]);
    if (subscriptions || devices || otherMembers) throw new BadRequestException({ code: 'USER_ALREADY_IN_ANOTHER_ACCOUNT' });
  }
}
