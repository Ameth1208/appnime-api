import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { randomHumanCode, randomSecret } from '../../../../common/crypto/codes';
import { sha256 } from '../../../../common/crypto/hash';
import { RequestDeviceLinkInput } from '../../device-link.schemas';

@Injectable()
export class RequestDeviceLinkUseCase {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  async execute(input: RequestDeviceLinkInput) {
    const claimSecret = randomSecret();
    const ttlSeconds = Number(this.config.get('DEVICE_LINK_TTL_SECONDS', 600));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomHumanCode(2, 3);
      try {
        const link = await this.prisma.deviceLink.create({
          data: {
            codeHash: sha256(code),
            codeHint: code,
            claimSecretHash: sha256(claimSecret),
            devicePayload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          },
        });
        return {
          linkId: link.id,
          code,
          claimSecret,
          expiresAt: link.expiresAt,
          qrUrl: `${this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '')}/link/${code}`,
        };
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    throw new ServiceUnavailableException({ code: 'DEVICE_LINK_CODE_UNAVAILABLE' });
  }
}
