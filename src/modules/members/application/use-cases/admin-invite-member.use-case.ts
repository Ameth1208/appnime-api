import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../common/database/prisma.service';
import { randomSecret } from '../../../../common/crypto/codes';
import { sha256 } from '../../../../common/crypto/hash';
import { addHours } from '../../../../common/dates/date-math';

@Injectable()
export class AdminInviteMemberUseCase {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async execute(adminUserId: string, accountId: string, email: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const plan = account.subscriptions[0]?.plan ?? null;
    const alreadyMember = await this.prisma.accountMember.findFirst({ where: { accountId, status: 'ACTIVE', user: { email } } });
    if (alreadyMember) throw new BadRequestException({ code: 'ALREADY_MEMBER' });
    const alreadyInvited = await this.prisma.invitation.findFirst({ where: { accountId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (alreadyInvited) throw new BadRequestException({ code: 'INVITATION_ALREADY_PENDING' });
    if (plan) {
      const activeMembers = await this.prisma.accountMember.count({ where: { accountId, role: 'MEMBER', status: 'ACTIVE' } });
      const pendingInvitations = await this.prisma.invitation.count({ where: { accountId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (activeMembers + pendingInvitations >= plan.maxAdditionalMembers) {
        throw new BadRequestException({ code: 'MEMBER_LIMIT_REACHED', maxAdditionalMembers: plan.maxAdditionalMembers });
      }
    }
    const token = randomSecret();
    const ttlHours = Number(this.config.get('INVITATION_TTL_HOURS', 168));
    const expiresAt = addHours(new Date(), ttlHours);
    await this.prisma.invitation.create({
      data: { accountId, email, createdById: adminUserId, tokenHash: sha256(token), expiresAt },
    });
    return { token, email, expiresAt };
  }
}
