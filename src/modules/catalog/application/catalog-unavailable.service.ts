import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { CatalogUnavailable } from '@prisma/client';
import { Inject } from '@nestjs/common';
import type { MetadataProvider } from '../domain/metadata-provider.interface';

const METADATA_PROVIDER = 'CATALOG_METADATA_PROVIDER';
import { SourceRegistryService } from './source-registry.service';
import { DiscoveryService } from './discovery.service';
import type { DiscoverInput, ProviderDiscoveredSource } from '../domain/types';

/// Providers para los que se intenta discovery al verificar un título.
const CHECK_PROVIDERS = ['unlimplay', 'nsrplay', 'vidlink'];

/// Límite de episodios a recorrer por chequeo (series muy largas). Si se
/// alcanza sin hallazgo, se asume que el título no tiene contenido.
const MAX_EPISODES_PER_CHECK = 500;

/// Concurrencia de discovery de episodios para no saturar providers.
const CHECK_CONCURRENCY = 3;

/// Días hasta la próxima re-verificación automática tras un chequeo.
const RECHECK_DAYS = 30;

export interface CheckResult {
  tmdbId: string;
  contentType: string;
  resolved: boolean;
  episodesChecked: number;
  sourcesFound: number;
  partial: boolean;
}

export interface UnavailableCreateInput {
  tmdbId: string;
  contentType: string;
  title: string;
  posterUrl?: string;
  year?: number;
}

@Injectable()
export class UnavailableCatalogService {
  private readonly logger = new Logger(UnavailableCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SourceRegistryService,
    private readonly discovery: DiscoveryService,
    @Inject(METADATA_PROVIDER) private readonly metadata: MetadataProvider,
  ) {}

  // ── Listado / gestión de la tabla ─────────────────────────────────────────

  async list(params: { q?: string; contentType?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const size = Math.min(100, Math.max(1, Number(params.pageSize) || 25));
    const where: Record<string, unknown> = {
      ...(params.contentType ? { contentType: params.contentType } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' } },
              { tmdbId: { contains: params.q } },
            ],
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.catalogUnavailable.count({ where }),
      this.prisma.catalogUnavailable.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return { data, total, page, pageSize: size };
  }

  async isBlocked(tmdbId: string, contentType: string): Promise<boolean> {
    return Boolean(
      await this.prisma.catalogUnavailable.findUnique({
        where: { tmdbId_contentType: { tmdbId, contentType } },
        select: { id: true },
      }),
    );
  }

  /// Dados items del catálogo con `id` (tmdbId) y `type`, filtra los que
  /// están marcados como indisponibles. `type` puede ser 'movie' | 'series' |
  /// 'anime'. 'anime' y 'series' comparten tablas (son series de TMDB).
  async filterAvailable<T extends { id: string; type: string }>(
    items: T[],
  ): Promise<T[]> {
    if (items.length === 0) return items;
    const blocked = await this.prisma.catalogUnavailable.findMany({
      where: {
        OR: items.map((it) => ({
          tmdbId: it.id,
          contentType: this.normalizeContentType(it.type),
        })),
      },
      select: { tmdbId: true },
      distinct: ['tmdbId'],
    });
    const blockedIds = new Set(blocked.map((b) => b.tmdbId));
    return items.filter((it) => !blockedIds.has(it.id));
  }

  async hasAnyBlocked(ids: string[], contentType: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.catalogUnavailable.findMany({
      where: { tmdbId: { in: ids }, contentType },
      select: { tmdbId: true },
    });
    return new Set(rows.map((r) => r.tmdbId));
  }

  async remove(tmdbId: string, contentType: string): Promise<{ ok: boolean }> {
    await this.prisma.catalogUnavailable.delete({
      where: { tmdbId_contentType: { tmdbId, contentType } },
    });
    return { ok: true };
  }

  /// Marca manualmente un título como indisponible (registro desde admin).
  async register(input: UnavailableCreateInput): Promise<CatalogUnavailable> {
    const normalized = this.normalizeContentType(input.contentType);
    return this.prisma.catalogUnavailable.upsert({
      where: {
        tmdbId_contentType: { tmdbId: input.tmdbId, contentType: normalized },
      },
      update: {
        title: input.title,
        posterUrl: input.posterUrl ?? null,
        year: input.year ?? null,
        nextCheckAt: new Date(Date.now() + RECHECK_DAYS * 24 * 60 * 60 * 1000),
      },
      create: {
        tmdbId: input.tmdbId,
        contentType: normalized,
        title: input.title,
        posterUrl: input.posterUrl ?? null,
        year: input.year ?? null,
        nextCheckAt: new Date(Date.now() + RECHECK_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }

  // ── Chequeo completo de un título ─────────────────────────────────────────

  /// Verifica un título completo: si hay UNA FUENTE en cualquier temporada/
  /// episodio de todos los proveedores → disponible. Si ninguna → indisponible
  /// (se registra en la tabla). Devuelve el resultado sin mutar (la mutación la
  /// hace el caller vía `applyResult`).
  async checkTitle(
    tmdbId: string,
    contentType: string,
    details?: { title?: string; posterUrl?: string; year?: number },
  ): Promise<CheckResult> {
    const ct = this.normalizeContentType(contentType);
    let episodesChecked = 0;
    let sourcesFound = 0;
    let partial = false;

    try {
      if (ct === 'movie') {
        const found = await this.discoverAndCountSources({ tmdbId, contentType: 'movie' });
        sourcesFound += found;
        episodesChecked = 1;
      } else {
        // series / anime: enumerar temporadas + episodios via metadata.
        let seasonNumbers: number[] = [];
        try {
          const detailsMeta = await this.metadata.seriesDetails(String(tmdbId));
          seasonNumbers = detailsMeta.seasons
            .map((s) => s.number)
            .filter((n) => n >= 1)
            .sort((a, b) => a - b);
        } catch {
          seasonNumbers = [1];
        }

        const queue: { season: number; episode: number }[] = [];
        for (const season of seasonNumbers) {
          let episodes: { number: number }[] = [];
          try {
            episodes = await this.metadata.seasonEpisodes(String(tmdbId), season);
          } catch {
            episodes = [{ number: 1 }];
          }
          for (const ep of episodes) {
            queue.push({ season, episode: ep.number });
          }
        }

        // Early exit cuando se alcanza el límite/concurrencia.
        outer: for (let i = 0; i < queue.length; i += CHECK_CONCURRENCY) {
          const batch = queue.slice(i, i + CHECK_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (b) =>
              this.discoverAndCountSources({
                tmdbId,
                contentType: ct,
                season: b.season,
                episode: b.episode,
              }),
            ),
          );
          for (const r of results) {
            if (r.status === 'fulfilled') sourcesFound += r.value;
          }
          episodesChecked += batch.length;
          if (sourcesFound > 0) break outer;
          if (episodesChecked >= MAX_EPISODES_PER_CHECK) {
            partial = true;
            break;
          }
        }

        if (episodesChecked === 0) partial = true;
      }

      this.logger.log(
        `check ${tmdbId} (${ct}): episodes=${episodesChecked} sources=${sourcesFound}${partial ? ' (partial)' : ''}`,
      );

      const resolved = sourcesFound > 0;
      if (!resolved && !partial && details) {
        // Título sin contenido → registrar en la tabla.
        this.applyResult({ tmdbId, contentType: ct, resolved, details });
      }

      return { tmdbId, contentType: ct, resolved, episodesChecked, sourcesFound, partial };
    } catch (err) {
      this.logger.warn(`check ${tmdbId} falló: ${String(err).slice(0, 120)}`);
      return { tmdbId, contentType: ct, resolved: true, episodesChecked, sourcesFound, partial: true };
    }
  }

  /// Aplica el resultado de un chequeo: registra o elimina de la tabla.
  async applyResult(r: {
    tmdbId: string;
    contentType: string;
    resolved: boolean;
    details?: { title?: string; posterUrl?: string; year?: number };
  }): Promise<void> {
    const ct = this.normalizeContentType(r.contentType);
    if (r.resolved) {
      await this.prisma.catalogUnavailable
        .delete({ where: { tmdbId_contentType: { tmdbId: r.tmdbId, contentType: ct } } })
        .catch(() => undefined);
      return;
    }
    await this.register({
      tmdbId: r.tmdbId,
      contentType: ct,
      title: r.details?.title ?? r.tmdbId,
      posterUrl: r.details?.posterUrl,
      year: r.details?.year,
    });
  }

  // ── Re-verificación programada (job) ──────────────────────────────────────

  /// Re-verifica todos los títulos cuya nextCheckAt ya venció (30 días).
  async recheckDue(): Promise<{ checked: number; resolved: number; stillUnavailable: number }> {
    const due = await this.prisma.catalogUnavailable.findMany({
      where: { nextCheckAt: { lte: new Date() } },
      select: { tmdbId: true, contentType: true },
      take: 200,
    });
    let resolved = 0;
    let still = 0;
    for (const item of due) {
      try {
        const meta = await this.metadataFor(item.tmdbId, item.contentType);
        const result = await this.checkTitle(item.tmdbId, item.contentType, meta);
        if (result.resolved) {
          await this.applyResult(result);
          resolved += 1;
        } else {
          still += 1;
          // Progamar siguiente intento dentro de 30 días.
          await this.prisma.catalogUnavailable.update({
            where: { tmdbId_contentType: { tmdbId: item.tmdbId, contentType: item.contentType } },
            data: { nextCheckAt: new Date(Date.now() + RECHECK_DAYS * 24 * 60 * 60 * 1000) },
          });
        }
      } catch (err) {
        this.logger.warn(`recheck ${item.tmdbId} falló: ${String(err).slice(0, 100)}`);
      }
    }
    return { checked: due.length, resolved, stillUnavailable: still };
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  /// Hace discovery de una unidad (película o episodio) y cuenta cuántas
  /// fuentes existieron. No guarda nada: pregunta contra los providers.
  private async discoverAndCountSources(input: {
    tmdbId: string;
    contentType: string;
    season?: number;
    episode?: number;
  }): Promise<number> {
    const byProvider = await this.discovery.discoverAll(
      input as DiscoverInput,
      CHECK_PROVIDERS,
      async () => false, // chequeo siempre forzado (no respeta cache negativa)
    );
    let count = 0;
    for (const [, sources] of byProvider) {
      count += (sources as ProviderDiscoveredSource[]).length;
    }
    return count;
  }

  private async metadataFor(
    tmdbId: string,
    contentType: string,
  ): Promise<{ title?: string; posterUrl?: string; year?: number }> {
    try {
      if (this.normalizeContentType(contentType) === 'movie') {
        const d = await this.metadata.movieDetails(tmdbId);
        return { ...d };
      }
      const d = await this.metadata.seriesDetails(tmdbId);
      return { ...d };
    } catch {
      return {};
    }
  }

  private normalizeContentType(contentType: string): string {
    return contentType === 'movie' ? 'movie' : 'series';
  }
}
