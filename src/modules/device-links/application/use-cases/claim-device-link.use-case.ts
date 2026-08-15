import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { sha256 } from '../../../../common/crypto/hash';
import { CreateAuthSessionUseCase } from '../../../auth/application/use-cases/create-auth-session.use-case';

@Injectable()
export class ClaimDeviceLinkUseCase {
  constructor(private readonly prisma: PrismaService, private readonly createSession: CreateAuthSessionUseCase) {}
  async execute(linkId: string, claimSecret: string) {
    const link = await this.prisma.deviceLink.findUnique({ where: { id: linkId } });
    if (!link || link.claimSecretHash !== sha256(claimSecret) || link.expiresAt <= new Date()) throw new BadRequestException({ code: 'DEVICE_LINK_INVALID_OR_EXPIRED' });
    if (link.status === 'PENDING') return { status: 'PENDING' as const };
    if (link.status !== 'APPROVED' || !link.approvedByUserId || !link.deviceId) throw new BadRequestException({ code: 'DEVICE_LINK_NOT_CLAIMABLE' });
    const changed = await this.prisma.deviceLink.updateMany({ where: { id: link.id, status: 'APPROVED' }, data: { status: 'CLAIMED', claimedAt: new Date() } });
    if (!changed.count) throw new BadRequestException({ code: 'DEVICE_LINK_ALREADY_CLAIMED' });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: link.approvedByUserId } });
    const tokens = await this.createSession.execute(user, link.deviceId);
    return { status: 'CLAIMED' as const, ...tokens, deviceId: link.deviceId };
  }
}
