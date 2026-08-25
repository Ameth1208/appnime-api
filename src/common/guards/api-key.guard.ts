import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

/// Llave general de acceso a la API (header `x-api-key` o query `?key=`).
///
/// - Se registra GLOBALMENTE vía APP_GUARD: sin llave configurada no hay
///   protección (desarrollo); con ella, TODOS los endpoints la exigen salvo
///   los marcados con @SkipApiKey() — auth (login público), admin (protegido
///   por su propio JWT de administrador) y health.
/// - La query `?key=` existe para los URLs de playlist/proxy que el
///   reproductor abre sin headers custom.

export const SKIP_API_KEY = 'skipApiKey';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('CATALOG_API_KEY') ?? '';
    if (!expected) return true;

    // Exención explícita (controller o handler).
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_API_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const provided =
      request.headers?.['x-api-key'] ?? request.query?.key ?? '';
    if (
      typeof provided === 'string' &&
      provided.length > 0 &&
      safeEqual(provided, expected)
    ) {
      return true;
    }
    throw new UnauthorizedException({ code: 'API_KEY_REQUIRED' });
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/// Genera una llave nueva (utilidad para CLI/setup).
export function generateApiKey(): string {
  return randomBytes(24).toString('base64url');
}
