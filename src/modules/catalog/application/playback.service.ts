import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlaybackLease, ProviderDiscoveredSource } from '../domain/types';
import { DiscoveryService } from './discovery.service';
import {
  SourceRegistryService,
  type SourceCandidate,
} from './source-registry.service';
import { ResolverRegistry } from '../infrastructure/providers/resolvers/resolver-registry';

export interface ResolveRequest {
  tmdbId: string;
  contentType: string; // movie | series | anime
  season?: number;
  episode?: number;
  languageCode?: string;
}

export interface ResolvedLease extends PlaybackLease {
  leaseId: string;
  sourceId: string;
  provider: string;
  server: string;
  languageCode: string;
  languageName: string;
}

const MAX_LEASES = 3;
const RESOLVE_TIMEOUT_MS = 25000;

/**
 * Orquestador de reproducción v2.
 *
 * Flujo de Play:
 *   1. Lee fuentes conocidas del SourceRegistry (rápido).
 *   2. Si no hay, ejecuta discovery una vez y persiste las fuentes.
 *   3. Resuelve SOLO las mejores fuentes hasta obtener 2-3 leases frescos.
 *   4. Health scoring por intento; circuit breaker automático.
 *   5. Si todo falla y no hubo discovery reciente → fuerza re-discovery.
 */
@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);

  /// Leases emitidos recientemente, para feedback de la app
  /// (POST /playback/{leaseId}/success | /failure).
  private readonly activeLeases = new Map<string, { sourceId: string; expiresAt: number }>();

  /// Providers con discovery implementado.
  private readonly knownProviders = ['nsrplay', 'unlimplay', 'vidlink'];

  constructor(
    private readonly registry: SourceRegistryService,
    private readonly discovery: DiscoveryService,
    private readonly resolvers: ResolverRegistry,
    private readonly config: ConfigService,
  ) {}

  async prepare(req: ResolveRequest): Promise<{ discovered: number }> {
    const key = this.flightKey(req, 'prepare');
    return this.registry.singleFlight(key, async () => {
      const existing = await this.registry.findCandidates({
        tmdbId: req.tmdbId,
        contentType: req.contentType,
        seasonNum: req.season,
        episodeNum: req.episode,
        limit: 1,
      });
      if (existing.length > 0) return { discovered: 0 };
      const found = await this.discoverAndSave(req);
      return { discovered: found };
    });
  }

  async resolve(req: ResolveRequest): Promise<ResolvedLease[]> {
    const key = this.flightKey(req, 'resolve');
    return this.registry.singleFlight(key, () => this.resolveOnce(req));
  }

  /// Feedback real de la app: éxito solo cuenta cuando el video avanzó.
  reportSuccess(leaseId: string): boolean {
    const entry = this.activeLeases.get(leaseId);
    if (!entry) return false;
    this.activeLeases.delete(leaseId);
    void this.registry.recordSuccess(entry.sourceId).catch(() => undefined);
    return true;
  }

  reportFailure(leaseId: string, reason?: string): boolean {
    const entry = this.activeLeases.get(leaseId);
    if (!entry) return false;
    this.activeLeases.delete(leaseId);
    void this.registry
      .recordFailure(entry.sourceId, new Error(reason ?? 'playback_failure'))
      .catch(() => undefined);
    return true;
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private async resolveOnce(req: ResolveRequest): Promise<ResolvedLease[]> {
    let didDiscover = false;
    let candidates = await this.registry.findCandidates({
      tmdbId: req.tmdbId,
      contentType: req.contentType,
      seasonNum: req.season,
      episodeNum: req.episode,
      languageCode: req.languageCode,
    });

    if (candidates.length === 0) {
      const found = await this.discoverAndSave(req);
      didDiscover = found > 0;
      candidates = await this.registry.findCandidates({
        tmdbId: req.tmdbId,
        contentType: req.contentType,
        seasonNum: req.season,
        episodeNum: req.episode,
        languageCode: req.languageCode,
      });
    }

    const leases = await this.resolveCandidates(candidates, req.languageCode);

    // Todo falló y no descubrimos en este request → re-discovery forzado.
    if (leases.length === 0 && !didDiscover) {
      this.logger.log(`todas las fuentes fallaron para ${req.tmdbId}; forzando re-discovery`);
      await this.discoverAndSave(req, { ignoreNegativeCache: true });
      candidates = await this.registry.findCandidates({
        tmdbId: req.tmdbId,
        contentType: req.contentType,
        seasonNum: req.season,
        episodeNum: req.episode,
        languageCode: req.languageCode,
      });
      return this.resolveCandidates(candidates, req.languageCode);
    }

    return leases;
  }

  private async resolveCandidates(
    candidates: SourceCandidate[],
    languageCode?: string,
  ): Promise<ResolvedLease[]> {
    const leases: ResolvedLease[] = [];
    const perLanguage = new Map<string, number>();

    for (const source of candidates) {
      if (leases.length >= MAX_LEASES) break;
      const usedForLang = perLanguage.get(source.languageCode) ?? 0;
      if (usedForLang >= 2) continue; // máximo 2 fuentes por idioma

      const started = Date.now();
      try {
        const fresh = await this.withTimeout(
          this.resolvers.resolve(source),
          RESOLVE_TIMEOUT_MS,
        );
        if (fresh.length === 0) throw new Error('respuesta vacía');
        void this.registry.recordSuccess(source.id, Date.now() - started);

        for (const lease of fresh) {
          if (leases.length >= MAX_LEASES) break;
          const leaseId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          this.activeLeases.set(leaseId, {
            sourceId: source.id,
            expiresAt: lease.expiresAt?.getTime() ?? Date.now() + 10 * 60 * 1000,
          });
          leases.push({
            ...lease,
            leaseId,
            sourceId: source.id,
            provider: source.providerId,
            server: source.serverId,
            languageCode: source.languageCode,
            languageName: source.languageName,
          });
        }
        perLanguage.set(source.languageCode, usedForLang + 1);
      } catch (err) {
        const cls = await this.registry.recordFailure(source.id, err);
        this.logger.log(
          `resolve ${source.providerId}/${source.serverId} (${source.languageCode}) falló [${cls}]: ${String(err instanceof Error ? err.message : err).slice(0, 90)}`,
        );
      }
    }
    void languageCode;

    // Limpieza oportunista de leases vencidos.
    const now = Date.now();
    for (const [id, entry] of this.activeLeases) {
      if (entry.expiresAt < now) this.activeLeases.delete(id);
    }

    return leases;
  }

  private async discoverAndSave(
    req: ResolveRequest,
    options: { ignoreNegativeCache?: boolean } = {},
  ): Promise<number> {
    const input = {
      tmdbId: req.tmdbId,
      contentType: req.contentType as 'movie' | 'series' | 'anime',
      season: req.season ?? 0,
      episode: req.episode ?? 0,
    };
    const byProvider = await this.discovery.discoverAll(
      input,
      this.knownProviders,
      async (providerId) =>
        !options.ignoreNegativeCache &&
        (await this.registry.isNegativeCached(
          req.tmdbId,
          req.contentType,
          req.season ?? 0,
          req.episode ?? 0,
          providerId,
        )),
    );

    let total = 0;
    const successfulProviders = new Set<string>();
    for (const [providerId, sources] of byProvider) {
      if (sources.length === 0) continue;
      successfulProviders.add(providerId);
      await this.registry.saveSources(sources as ProviderDiscoveredSource[]);
      total += sources.length;
    }
    // Negative cache para todo provider sin resultados en este discovery.
    for (const providerId of this.knownProviders) {
      if (!successfulProviders.has(providerId)) {
        await this.registry.markNotFound({
          tmdbId: req.tmdbId,
          contentType: req.contentType,
          seasonNum: req.season,
          episodeNum: req.episode,
          providerId,
        });
      }
    }
    this.logger.log(`discovery ${req.tmdbId} S${req.season ?? 0}E${req.episode ?? 0}: ${total} fuentes`);
    return total;
  }

  private flightKey(req: ResolveRequest, scope: string): string {
    return `${scope}:${req.contentType}:${req.tmdbId}:${req.season ?? 0}:${req.episode ?? 0}:${req.languageCode ?? '*'}`;
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms),
      ),
    ]);
  }
}
