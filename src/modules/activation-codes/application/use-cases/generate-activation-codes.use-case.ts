import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { randomHumanCode } from '../../../../common/crypto/codes';
import { sha256 } from '../../../../common/crypto/hash';
import { GenerateCodesInput } from '../../activation-code.schemas';

@Injectable()
export class GenerateActivationCodesUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(adminUserId: string, input: GenerateCodesInput) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
    if (input.kind === 'LIFETIME' && plan.billingInterval !== 'LIFETIME') {
      throw new BadRequestException({ code: 'LIFETIME_CODE_REQUIRES_LIFETIME_PLAN' });
    }
    if (input.kind !== 'LIFETIME' && plan.billingInterval === 'LIFETIME') {
      throw new BadRequestException({ code: 'LIFETIME_PLAN_REQUIRES_LIFETIME_CODE' });
    }
    const plaintextCodes = Array.from({ length: input.quantity }, () => `APPN-${randomHumanCode(3, 4)}`);
    const batch = await this.prisma.activationCodeBatch.create({
      data: {
        name: input.name,
        campaign: input.campaign,
        reseller: input.reseller,
        notes: input.notes,
        createdById: adminUserId,
        codes: {
          create: plaintextCodes.map((code) => ({
            planId: input.planId,
            codeHash: sha256(code),
            codePrefix: code.slice(0, 9),
            kind: input.kind,
            durationUnit: input.kind === 'LIFETIME' ? 'LIFETIME' : input.durationUnit,
            durationValue: input.kind === 'LIFETIME' ? 1 : input.durationValue,
            valueCents: input.kind === 'TRIAL' || input.kind === 'COMPLIMENTARY' ? 0 : input.valueCents,
            redemptionExpiresAt: input.redemptionExpiresAt,
          })),
        },
      },
      include: { _count: { select: { codes: true } } },
    });
    // Resolver nombre del creador para el audit trail.
    const creator = adminUserId
      ? await this.prisma.user.findUnique({ where: { id: adminUserId }, select: { email: true, displayName: true } })
      : null;
    return {
      batchId: batch.id,
      codes: plaintextCodes,
      batchName: batch.name,
      createdBy: creator?.displayName ?? creator?.email ?? 'Unknown',
      totalCodes: batch._count.codes,
      valueCents: input.valueCents,
    };
  }
}
