import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlaybackLease, ProviderDiscoveredSource } from '../domain/types';
import { DiscoveryService } from './discovery.service';
import {
  SourceRegistryService,
  type SourceCandidate,
} from './source-registry.service';
import { ResolverRegistry } from '../infrastructure/providers/resolvers/resolver-registry';
import { validateStreamUrl } from '../infrastructure/http/url-validate.util';

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
/// Timeout por provider:10s (bajado de15s para intentar más candidatos
/// dentro del deadline global de40s).
const RESOLVE_TIMEOUT_MS = 10000;
/// Timeout de validación ligera (HEAD/GET) antes de devolver un lease.
const VALIDATE_TIMEOUT_MS = 5000;
/// Presupuesto total de una resolución: si se agota, devolvemos lo que haya
/// (o vacío para que la app reintente) en vez de dejar al usuario colgado.
const RESOLVE_DEADLINE_MS = 40000;

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
  /// jkanime NO es proveedor de streams: solo se usa para búsqueda/filtrado
  /// del catálogo anime. El playback del anime va por unlimplay/nsrplay/vidlink
  /// con TMDB IDs, igual que las series.
  readonly knownProviders = ['nsrplay', 'unlimplay', 'vidlink'];

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
    const deadline = Date.now() + RESOLVE_DEADLINE_MS;
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

    const leases = await this.resolveCandidates(candidates, deadline);

    // Todo falló y no descubrimos en este request → re-discovery forzado,
    // solo si aún queda presupuesto de tiempo.
    if (leases.length === 0 && !didDiscover && Date.now() < deadline) {
      this.logger.log(`todas las fuentes fallaron para ${req.tmdbId}; forzando re-discovery`);
      await this.discoverAndSave(req, { ignoreNegativeCache: true });
      candidates = await this.registry.findCandidates({
        tmdbId: req.tmdbId,
        contentType: req.contentType,
        seasonNum: req.season,
        episodeNum: req.episode,
        languageCode: req.languageCode,
      });
      return this.resolveCandidates(candidates, deadline);
    }

    return leases;
  }

  private async resolveCandidates(
    candidates: SourceCandidate[],
    deadline: number,
  ): Promise<ResolvedLease[]> {
    const leases: ResolvedLease[] = [];
    const perLanguage = new Map<string, number>();
    const perProvider = new Map<string, number>();

    // Diversidad primero: un mejor candidato por idioma distinto, luego por
    // provider distinto, y finalmente el resto por score.
    const ordered = this.diversify(candidates);

    for (const source of ordered) {
      if (leases.length >= MAX_LEASES) break;
      // Presupuesto agotado: devolver lo que haya en vez de colgar al user.
      if (Date.now() > deadline) {
        this.logger.log('resolve: deadline alcanzado, devolviendo lo resuelto');
        break;
      }
      const usedForLang = perLanguage.get(source.languageCode) ?? 0;
      if (usedForLang >= 2) continue; // máximo 2 fuentes por idioma
      const usedForProvider = perProvider.get(source.providerId) ?? 0;
      if (usedForProvider >= 2 && leases.length >= 2) continue;

      const started = Date.now();
      try {
        const fresh = await this.withTimeout(
          this.resolvers.resolve(source),
          RESOLVE_TIMEOUT_MS,
        );
        if (fresh.length === 0) throw new Error('respuesta vacía');

        // Validación ligera: verificar que la URL responde correctamente
        // antes de devolverla al cliente. Evita URLs muertas/expiradas.
        const valid: typeof fresh = [];
        for (const lease of fresh) {
          if (Date.now() > deadline) break;
          const v = await validateStreamUrl(lease, VALIDATE_TIMEOUT_MS);
          if (v.ok) {
            valid.push(lease);
          } else {
            this.logger.log(
              `resolve ${source.providerId}/${source.serverId}: lease rechazado (${v.reason})`,
            );
          }
        }
        if (valid.length === 0) throw new Error('leases rechazados por validación');

        void this.registry.recordSuccess(source.id, Date.now() - started);

        for (const lease of valid) {
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
        perProvider.set(source.providerId, usedForProvider + 1);
      } catch (err) {
        const cls = await this.registry.recordFailure(source.id, err);
        this.logger.log(
          `resolve ${source.providerId}/${source.serverId} (${source.languageCode}) falló [${cls}]: ${String(err instanceof Error ? err.message : err).slice(0, 90)}`,
        );
      }
    }

    // Limpieza oportunista de leases vencidos.
    const now = Date.now();
    for (const [id, entry] of this.activeLeases) {
      if (entry.expiresAt < now) this.activeLeases.delete(id);
    }

    return leases;
  }

  /// Reordena candidatos priorizando diversidad: ronda 1 = el mejor de cada
  /// idioma distinto; ronda 2 = el mejor de cada provider aún sin usar; ronda
  /// 3 = el resto por score. Así una serie con latino+subtitulado+inglés
  /// devuelve las tres opciones aunque un provider tenga más servidores.
  private diversify(candidates: SourceCandidate[]): SourceCandidate[] {
    const pool = [...candidates];
    const picked = new Set<string>();
    const result: SourceCandidate[] = [];

    for (const lang of new Set(pool.map((c) => c.languageCode))) {
      const best = pool.find((c) => c.languageCode === lang && !picked.has(c.id));
      if (best) {
        result.push(best);
        picked.add(best.id);
      }
    }
    for (const provider of new Set(pool.map((c) => c.providerId))) {
      const best = pool.find((c) => c.providerId === provider && !picked.has(c.id));
      if (best) {
        result.push(best);
        picked.add(best.id);
      }
    }
    for (const c of pool) {
      if (!picked.has(c.id)) result.push(c);
    }
    return result;
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
    const successful = new Set<string>();
    const emptyButReachable = new Set<string>();
    for (const [providerId, sources] of byProvider) {
      if (sources.length === 0) {
        emptyButReachable.add(providerId);
        continue;
      }
      successful.add(providerId);
      await this.registry.saveSources(sources as ProviderDiscoveredSource[]);
      total += sources.length;
    }
    for (const providerId of this.knownProviders) {
      if (successful.has(providerId)) continue;
      // Provider alcanzable pero sin el título → no existe ahí (6h).
      // Provider que FALLÓ (timeout/Cloudflare) → cooldown corto (10 min).
      await this.registry.markNotFound({
        tmdbId: req.tmdbId,
        contentType: req.contentType,
        seasonNum: req.season,
        episodeNum: req.episode,
        providerId,
        reason: emptyButReachable.has(providerId) ? 'not_found' : 'transient_error',
      });
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
