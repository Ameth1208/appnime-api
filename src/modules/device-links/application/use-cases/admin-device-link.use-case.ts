import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { randomHumanCode, randomSecret } from '../../../../common/crypto/codes';
import { sha256 } from '../../../../common/crypto/hash';

export type AdminDeviceLinkInput = { deviceName?: string; brand?: string; model?: string };

@Injectable()
export class AdminDeviceLinkUseCase {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async execute(accountId: string, input: AdminDeviceLinkInput) {
    const claimSecret = randomSecret();
    const ttlSeconds = Number(this.config.get('DEVICE_LINK_TTL_SECONDS', 600));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomHumanCode(2, 3);
      try {
        const link = await this.prisma.deviceLink.create({
          data: {
            accountId,
            codeHash: sha256(code),
            codeHint: code,
            claimSecretHash: sha256(claimSecret),
            devicePayload: {
              installationId: `admin-${randomSecret(16)}`,
              platform: 'ANDROID_TV',
              brand: input.brand,
              model: input.model,
              deviceName: input.deviceName ?? 'Equipo vinculado por administrador',
            } as Prisma.InputJsonValue,
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
