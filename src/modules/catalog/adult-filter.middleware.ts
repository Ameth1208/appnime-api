import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../common/database/prisma.service';
import { TmdbService } from './infrastructure/tmdb/tmdb.service';

@Injectable()
export class AdultFilterMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // Por defecto filtrar adulto.
    this.tmdb.adultMode = false;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    try {
      // Extraer userId del JWT sin validar expiración estricta (solo para preferencia).
      const token = authHeader.substring(7);
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      const userId = payload.sub ?? payload.id;
      if (!userId) return next();

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { adultUnlocked: true },
      });
      if (user?.adultUnlocked) {
        this.tmdb.adultMode = true;
      }
    } catch {
      // Si falla la decodificación, mantener filtrado.
    }
    next();
  }
}


