import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../../common/crypto/hash';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async issue(user: { id: string; email: string }, sessionId: string, deviceId?: string | null) {
    const payload = { sub: user.id, email: user.email, sessionId, deviceId: deviceId ?? undefined };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS', 900)),
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sessionId, deviceId: deviceId ?? undefined, jti: randomUUID() },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: Number(this.config.get('REFRESH_TOKEN_TTL_SECONDS', 2_592_000)),
      },
    );
    return { accessToken, refreshToken };
  }

  hashRefresh(token: string) { return sha256(token); }

  verifyRefresh(token: string) {
    return this.jwt.verifyAsync<{ sub: string; sessionId: string; deviceId?: string }>(token, {
      secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
    });
  }
}
