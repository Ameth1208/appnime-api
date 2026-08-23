import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export interface CachedResolution {
  resolvedUrl: string;
  language: string;
  providerId: string;
  serverName: string;
  hasSubs: boolean;
  subLanguages: string[];
  quality?: string;
}

/// Cache global de resoluciones de stream compartida entre todos los usuarios.
///
/// Una entrada por contenido+idioma. Si cualquier usuario ya resolvió E1 en
/// latino, el siguiente que quiera latino carga instantáneamente.
///
/// También registra qué subtítulos están disponibles por stream y la calidad.
@Injectable()
export class StreamResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /// Busca una resolución previa exitosa para este contenido + idioma.
  async findCached(
    tmdbId: string,
    contentType: 'movie' | 'series' | 'anime',
    language: string,
    seasonNum?: number,
    episodeNum?: number,
  ): Promise<CachedResolution | null> {
    const record = await this.prisma.streamResolution.findUnique({
      where: {
        tmdbId_contentType_seasonNum_episodeNum_language: {
          tmdbId,
          contentType,
          seasonNum: seasonNum ?? 0,
          episodeNum: episodeNum ?? 0,
          language,
        },
      },
    });
    if (!record || !record.resolvedUrl) return null;

    // Solo usar cache si tiene menos de 30 minutos (los tokens expiran).
    const age = Date.now() - record.lastPlayedAt.getTime();
    if (age > 30 * 60 * 1000) return null;

    return {
      resolvedUrl: record.resolvedUrl,
      language: record.language,
      providerId: record.providerId,
      serverName: record.serverName,
      hasSubs: record.hasSubs,
      subLanguages: record.subLanguages,
      quality: record.quality ?? undefined,
    };
  }

  /// Registra o actualiza una resolución exitosa con toda la metadata.
  async save(params: {
    tmdbId: string;
    contentType: 'movie' | 'series' | 'anime';
    seasonNum?: number;
    episodeNum?: number;
    resolvedUrl: string;
    language: string;
    providerId: string;
    serverName: string;
    hasSubs?: boolean;
    subLanguages?: string[];
    quality?: string;
  }): Promise<void> {
    const uniqueKey = {
      tmdbId: params.tmdbId,
      contentType: params.contentType,
      seasonNum: params.seasonNum ?? 0,
      episodeNum: params.episodeNum ?? 0,
      language: params.language,
    };

    await this.prisma.streamResolution.upsert({
      where: {
        tmdbId_contentType_seasonNum_episodeNum_language: uniqueKey,
      },
      update: {
        resolvedUrl: params.resolvedUrl,
        providerId: params.providerId,
        serverName: params.serverName,
        hasSubs: params.hasSubs ?? false,
        subLanguages: params.subLanguages ?? [],
        quality: params.quality,
        attempts: { increment: 1 },
        lastPlayedAt: new Date(),
      },
      create: {
        tmdbId: params.tmdbId,
        contentType: params.contentType,
        seasonNum: params.seasonNum ?? 0,
        episodeNum: params.episodeNum ?? 0,
        language: params.language,
        resolvedUrl: params.resolvedUrl,
        providerId: params.providerId,
        serverName: params.serverName,
        hasSubs: params.hasSubs ?? false,
        subLanguages: params.subLanguages ?? [],
        quality: params.quality,
      },
    });
  }

  /// Lista todos los idiomas disponibles para un contenido/episodio.
  /// Útil para poblar el selector de idiomas del player sin re-resolver.
  async getAvailableLanguages(
    tmdbId: string,
    contentType: 'movie' | 'series' | 'anime',
    seasonNum?: number,
    episodeNum?: number,
  ): Promise<{ language: string; providerId: string; serverName: string; hasSubs: boolean; subLanguages: string[] }[]> {
    const records = await this.prisma.streamResolution.findMany({
      where: {
        tmdbId,
        contentType,
        seasonNum: seasonNum ?? undefined,
        episodeNum: episodeNum ?? undefined,
      },
      select: {
        language: true,
        providerId: true,
        serverName: true,
        hasSubs: true,
        subLanguages: true,
      },
      orderBy: { lastPlayedAt: 'desc' },
      distinct: ['language'],
    });

    return records.map((r) => ({
      language: r.language,
      providerId: r.providerId,
      serverName: r.serverName,
      hasSubs: r.hasSubs,
      subLanguages: r.subLanguages,
    }));
  }
}
