import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../common/database/prisma.service';
import { randomSecret } from '../../../../common/crypto/codes';
import { sha256 } from '../../../../common/crypto/hash';
import { addHours } from '../../../../common/dates/date-math';
import { AccountAccessService } from '../../../accounts/account-access.service';
import { SubscriptionPolicyService } from '../../../subscriptions/subscription-policy.service';

@Injectable()
export class InviteMemberUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly policy: SubscriptionPolicyService,
    private readonly config: ConfigService,
  ) {}
  async execute(ownerId: string, email: string) {
    const membership = await this.access.ownerMembership(ownerId);
    const entitlement = await this.policy.resolve(membership.accountId);
    if (!entitlement.active || !entitlement.plan.canInviteMembers) throw new BadRequestException({ code: 'INVITES_NOT_ALLOWED' });
    const alreadyMember = await this.prisma.accountMember.findFirst({ where: { accountId: membership.accountId, status: 'ACTIVE', user: { email } } });
    if (alreadyMember) throw new BadRequestException({ code: 'ALREADY_MEMBER' });
    const alreadyInvited = await this.prisma.invitation.findFirst({ where: { accountId: membership.accountId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (alreadyInvited) throw new BadRequestException({ code: 'INVITATION_ALREADY_PENDING' });
    const activeMembers = await this.prisma.accountMember.count({ where: { accountId: membership.accountId, role: 'MEMBER', status: 'ACTIVE' } });
    const pendingInvitations = await this.prisma.invitation.count({ where: { accountId: membership.accountId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (activeMembers + pendingInvitations >= entitlement.plan.maxAdditionalMembers) {
      throw new BadRequestException({ code: 'MEMBER_LIMIT_REACHED', maxAdditionalMembers: entitlement.plan.maxAdditionalMembers });
    }
    const token = randomSecret();
    const ttlHours = Number(this.config.get('INVITATION_TTL_HOURS', 168));
    await this.prisma.invitation.create({
      data: {
        accountId: membership.accountId,
        email,
        createdById: ownerId,
        tokenHash: sha256(token),
        expiresAt: addHours(new Date(), ttlHours),
      },
    });
    return { token, email, expiresAt: addHours(new Date(), ttlHours) };
  }
}
