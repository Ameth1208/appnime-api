import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { DiscoveredSource } from '../domain/types';

/// Clasificación de errores para health scoring.
export type FailureClass =
  | 'resolve_failed'
  | 'http_403'
  | 'http_404'
  | 'http_429'
  | 'http_5xx'
  | 'timeout'
  | 'manifest_invalid'
  | 'network';

const SCORE_SUCCESS = +5;
const SCORE_FAILURE = -5;
const SCORE_403 = -15;
const SCORE_TIMEOUT = -10;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_HOURS = 6;

function classify(err: unknown): FailureClass {
  const msg = String(err instanceof Error ? err.message : err);
  if (/403/.test(msg)) return 'http_403';
  if (/404|410/.test(msg)) return 'http_404';
  if (/429/.test(msg)) return 'http_429';
  if (/5\d\d/.test(msg)) return 'http_5xx';
  if (/timeout/i.test(msg)) return 'timeout';
  if (/m3u8|manifest/i.test(msg)) return 'manifest_invalid';
  if (/fetch|network|socket|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'network';
  return 'resolve_failed';
}

export interface SourceCandidate {
  id: string;
  tmdbId: string;
  contentType: string;
  seasonNum: number;
  episodeNum: number;
  languageCode: string;
  languageName: string;
  providerId: string;
  serverId: string;
  providerItemId: string | null;
  providerUrl: string | null;
  quality: string | null;
  deliveryMode: string;
  score: number;
}

/**
 * Registro persistente de fuentes conocidas (`StreamSource`), mappings de
 * providers, caché negativa de discovery y health scoring con circuit
 * breaker. Todo lo estable vive aquí; las URLs efímeras NO.
 */
@Injectable()
export class SourceRegistryService {
  private readonly logger = new Logger(SourceRegistryService.name);

  /// Single-flight: una sola discovery/resolve por clave a la vez.
  private static readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  /// Ejecuta `fn` garantizando una única ejecución concurrente por clave.
  singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = SourceRegistryService.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => {
      SourceRegistryService.inflight.delete(key);
    });
    SourceRegistryService.inflight.set(key, p);
    return p;
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  /// Guarda/actualiza fuentes descubiertas (upsert por clave natural).
  async saveSources(
    sources: (DiscoveredSource & {
      tmdbId: string;
      contentType: string;
      seasonNum?: number;
      episodeNum?: number;
    })[],
  ): Promise<void> {
    for (const s of sources) {
      try {
        await this.prisma.streamSource.upsert({
          where: {
            tmdbId_contentType_seasonNum_episodeNum_languageCode_providerId_serverId: {
              tmdbId: s.tmdbId,
              contentType: s.contentType,
              seasonNum: s.seasonNum ?? 0,
              episodeNum: s.episodeNum ?? 0,
              languageCode: s.languageCode,
              providerId: s.providerId,
              serverId: s.serverId,
            },
          },
          update: {
            languageName: s.languageName,
            providerItemId: s.providerItemId ?? null,
            providerUrl: s.providerUrl ?? null,
            quality: s.quality ?? null,
            hasSubs: s.hasSubs ?? false,
            subLanguages: s.subLanguages ?? [],
            deliveryMode: s.deliveryMode,
            enabled: true,
            disabledUntil: null,
            consecutiveFailures: 0,
            lastCheckedAt: new Date(),
          },
          create: {
            tmdbId: s.tmdbId,
            contentType: s.contentType,
            seasonNum: s.seasonNum ?? 0,
            episodeNum: s.episodeNum ?? 0,
            languageCode: s.languageCode,
            languageName: s.languageName,
            providerId: s.providerId,
            serverId: s.serverId,
            providerItemId: s.providerItemId ?? null,
            providerUrl: s.providerUrl ?? null,
            quality: s.quality ?? null,
            hasSubs: s.hasSubs ?? false,
            subLanguages: s.subLanguages ?? [],
            deliveryMode: s.deliveryMode,
          },
        });
      } catch (err) {
        this.logger.warn(`saveSources upsert falló (${s.providerId}/${s.serverId}): ${String(err).slice(0, 120)}`);
      }
    }
  }

  /// Candidatos ordenados por score, excluyendo deshabilitados y circuit-
  /// breaker activo. Si `languageCode` viene, prioriza ese idioma primero
  /// pero incluye el resto como fallback ordenado detrás.
  async findCandidates(params: {
    tmdbId: string;
    contentType: string;
    seasonNum?: number;
    episodeNum?: number;
    languageCode?: string;
    limit?: number;
  }): Promise<SourceCandidate[]> {
    const rows = await this.prisma.streamSource.findMany({
      where: {
        tmdbId: params.tmdbId,
        contentType: params.contentType,
        seasonNum: params.seasonNum ?? 0,
        episodeNum: params.episodeNum ?? 0,
        enabled: true,
        OR: [{ disabledUntil: null }, { disabledUntil: { lt: new Date() } }],
      },
      orderBy: { score: 'desc' },
      take: params.limit ?? 30,
    });
    const langRank = (r: (typeof rows)[number]): number => {
      if (!params.languageCode) return r.languageCode === params.languageCode ? 0 : 1;
      return r.languageCode === params.languageCode ? 0 : 1;
    };
    return rows
      .sort((a, b) => langRank(a) - langRank(b) || b.score - a.score)
      .map((r) => ({
        id: r.id,
        tmdbId: r.tmdbId,
        contentType: r.contentType,
        seasonNum: r.seasonNum,
        episodeNum: r.episodeNum,
        languageCode: r.languageCode,
        languageName: r.languageName,
        providerId: r.providerId,
        serverId: r.serverId,
        providerItemId: r.providerItemId,
        providerUrl: r.providerUrl,
        quality: r.quality,
        deliveryMode: r.deliveryMode,
        score: r.score,
      }));
  }

  // ── Health / scoring ──────────────────────────────────────────────────────

  async recordSuccess(sourceId: string, resolveMs?: number): Promise<void> {
    const row = await this.prisma.streamSource.findUnique({ where: { id: sourceId } });
    if (!row) return;
    const avg =
      resolveMs != null
        ? row.avgResolveMs == null
          ? Math.round(resolveMs)
          : Math.round(row.avgResolveMs * 0.7 + resolveMs * 0.3)
        : row.avgResolveMs;
    await this.prisma.streamSource.update({
      where: { id: sourceId },
      data: {
        successCount: { increment: 1 },
        consecutiveFailures: 0,
        score: Math.min(100, row.score + SCORE_SUCCESS),
        avgResolveMs: avg,
        lastSuccessAt: new Date(),
        lastCheckedAt: new Date(),
        disabledUntil: null,
      },
    });
  }

  async recordFailure(sourceId: string, err: unknown): Promise<FailureClass> {
    const cls = classify(err);
    const penalty =
      cls === 'http_403' ? SCORE_403 : cls === 'timeout' ? SCORE_TIMEOUT : SCORE_FAILURE;
    const row = await this.prisma.streamSource.findUnique({ where: { id: sourceId } });
    if (!row) return cls;
    const consecutive = row.consecutiveFailures + 1;
    const openBreaker = consecutive >= CIRCUIT_BREAKER_FAILURES;
    await this.prisma.streamSource.update({
      where: { id: sourceId },
      data: {
        failureCount: { increment: 1 },
        consecutiveFailures: consecutive,
        score: Math.max(0, row.score + penalty),
        lastFailureAt: new Date(),
        lastCheckedAt: new Date(),
        ...(openBreaker
          ? { disabledUntil: new Date(Date.now() + CIRCUIT_BREAKER_MS) }
          : {}),
      },
    });
    if (openBreaker) {
      this.logger.warn(
        `circuit breaker OPEN ${row.providerId}/${row.serverId} (${consecutive} fallos) → skip ${CIRCUIT_BREAKER_MS / 1000}s`,
      );
    }
    return cls;
  }

  // ── Negative cache de discovery ───────────────────────────────────────────

  async isNegativeCached(
    tmdbId: string,
    contentType: string,
    seasonNum: number,
    episodeNum: number,
    providerId: string,
  ): Promise<boolean> {
    const row = await this.prisma.discoveryNegativeCache.findUnique({
      where: {
        tmdbId_contentType_seasonNum_episodeNum_providerId: {
          tmdbId,
          contentType,
          seasonNum,
          episodeNum,
          providerId,
        },
      },
    });
    return !!row && row.nextCheckAt > new Date();
  }

  async markNotFound(params: {
    tmdbId: string;
    contentType: string;
    seasonNum?: number;
    episodeNum?: number;
    providerId: string;
    reason?: string;
  }): Promise<void> {
    const nextCheckAt = new Date(Date.now() + NEGATIVE_CACHE_HOURS * 3600 * 1000);
    await this.prisma.discoveryNegativeCache.upsert({
      where: {
        tmdbId_contentType_seasonNum_episodeNum_providerId: {
          tmdbId: params.tmdbId,
          contentType: params.contentType,
          seasonNum: params.seasonNum ?? 0,
          episodeNum: params.episodeNum ?? 0,
          providerId: params.providerId,
        },
      },
      update: { nextCheckAt, reason: params.reason ?? 'not_found', updatedAt: new Date() },
      create: {
        tmdbId: params.tmdbId,
        contentType: params.contentType,
        seasonNum: params.seasonNum ?? 0,
        episodeNum: params.episodeNum ?? 0,
        providerId: params.providerId,
        reason: params.reason ?? 'not_found',
        nextCheckAt,
      },
    }).catch(() => undefined);
  }

  // ── Provider content mapping ──────────────────────────────────────────────

  async getMapping(
    tmdbId: string,
    contentType: string,
    providerId: string,
  ): Promise<{ providerContentId: string; providerSlug?: string; providerUrl?: string } | null> {
    const row = await this.prisma.providerContentMapping.findUnique({
      where: { tmdbId_contentType_providerId: { tmdbId, contentType, providerId } },
    });
    if (!row) return null;
    return {
      providerContentId: row.providerContentId,
      providerSlug: row.providerSlug ?? undefined,
      providerUrl: row.providerUrl ?? undefined,
    };
  }

  async saveMapping(params: {
    tmdbId: string;
    contentType: string;
    providerId: string;
    providerContentId: string;
    providerSlug?: string;
    providerUrl?: string;
    confidence?: number;
  }): Promise<void> {
    await this.prisma.providerContentMapping.upsert({
      where: {
        tmdbId_contentType_providerId: {
          tmdbId: params.tmdbId,
          contentType: params.contentType,
          providerId: params.providerId,
        },
      },
      update: {
        providerContentId: params.providerContentId,
        providerSlug: params.providerSlug ?? null,
        providerUrl: params.providerUrl ?? null,
        confidence: params.confidence ?? 1,
      },
      create: { ...params, confidence: params.confidence ?? 1 },
    }).catch(() => undefined);
  }
}
