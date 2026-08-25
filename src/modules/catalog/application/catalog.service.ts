import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ContentSummary,
  Episode,
  ListParams,
  MovieCatalogProvider,
  MovieDetails,
  Page,
  ResolvedStream,
  SeriesCatalogProvider,
  SeriesDetails,
  TmdbKeyedProvider,
} from '../domain/types';
import type { CatalogMetadataItem, MetadataProvider } from '../domain/metadata-provider.interface';
import { normalizeText, similarity } from './text-similarity';
import type { AnyCatalogProvider } from '../infrastructure/providers/provider-factory';
import { needsTunnel, wrapPlaylistProxy } from '../infrastructure/http/tunnel.util';
import { StreamResolutionService } from '../infrastructure/providers/stream-resolution.service';
import { SourceRegistryService } from './source-registry.service';
import { PlaybackService } from './playback.service';
import { CatalogSearchService } from '../infrastructure/search/catalog-search.service';

export const MOVIE_PROVIDERS = 'CATALOG_MOVIE_PROVIDERS';
export const SERIES_PROVIDERS = 'CATALOG_SERIES_PROVIDERS';
export const METADATA_PROVIDER = 'CATALOG_METADATA_PROVIDER';

const LANG_PRIORITY = ['español latino', 'latino', 'español', 'castellano', 'subtitulado'];

function isTmdbKeyed(provider: AnyCatalogProvider): provider is AnyCatalogProvider & { supportsTmdbIds: true; resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]>; resolveEpisodeByTmdb(id: number | string, s: number, e: number): Promise<ResolvedStream[]> } {
  return (provider as Partial<TmdbKeyedProvider>).supportsTmdbIds === true;
}

/// Idiomas para la ficha: fuentes reales conocidas primero (prioridad
/// español), sin duplicados. Si aún no hay nada descubierto, lista vacía.
const LANG_ORDER = ['español latino', 'latino', 'español', 'castellano', 'subtitulado', 'inglés'];
function mergeLanguages(known: string[]): string[] {
  const unique = [...new Set(known.map((l) => l.trim()).filter(Boolean))];
  return unique.sort((a, b) => {
    const ra = LANG_ORDER.indexOf(a.toLowerCase()) + 1 || 99;
    const rb = LANG_ORDER.indexOf(b.toLowerCase()) + 1 || 99;
    return ra - rb;
  });
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(MOVIE_PROVIDERS) private readonly movieProviders: AnyCatalogProvider[],
    @Inject(SERIES_PROVIDERS) private readonly seriesProviders: AnyCatalogProvider[],
    @Inject(METADATA_PROVIDER) private readonly metadata: MetadataProvider,
    private readonly streamResolution: StreamResolutionService,
    private readonly searchEngine: CatalogSearchService,
    private readonly config: ConfigService,
    private readonly registry: SourceRegistryService,
    private readonly playback: PlaybackService,
  ) {}

  listProviders() {
    return {
      movies: this.movieProviders.map((p) => ({ id: p.id, displayName: p.displayName })),
      series: this.seriesProviders.map((p) => ({ id: p.id, displayName: p.displayName })),
      metadata: this.metadata.id,
    };
  }

  // ── Catálogo ──────────────────────────────────────────────────────────────

  async moviesPopular(params: ListParams): Promise<Page<ContentSummary>> {
    const items = await this.metadata.moviesPopular(params.page);
    return { items: items.map((m) => this.toSummary(m, 'movie')), page: params.page, hasMore: items.length >= 20 };
  }

  async seriesPopular(params: ListParams): Promise<Page<ContentSummary>> {
    const items = await this.metadata.seriesPopular(params.page);
    return { items: items.map((m) => this.toSummary(m, 'series')), page: params.page, hasMore: items.length >= 20 };
  }

  async searchMovies(query: string, page: number): Promise<Page<ContentSummary>> {
    if (!query.trim()) return { items: [], page, hasMore: false };
    const meili = await this.searchEngine.search(query, 'movie');
    if (meili.length > 0) return { items: meili.map((d) => this.docToSummary(d, 'movie')), page, hasMore: false };
    const items = await this.fuzzySearch('movie', query);
    return { items: items.map((m) => this.toSummary(m, 'movie')), page, hasMore: false };
  }

  async searchSeries(query: string, page: number): Promise<Page<ContentSummary>> {
    if (!query.trim()) return { items: [], page, hasMore: false };
    const meili = await this.searchEngine.search(query, 'series');
    if (meili.length > 0) return { items: meili.map((d) => this.docToSummary(d, 'series')), page, hasMore: false };
    const items = await this.fuzzySearch('series', query);
    return { items: items.map((m) => this.toSummary(m, 'series')), page, hasMore: false };
  }

  private docToSummary(d: { id: string; title: string; posterUrl?: string; year?: number; rating?: number }, type: 'movie' | 'series'): ContentSummary {
    return this.toSummary({ id: d.id.includes(':') ? d.id.split(':')[1] : d.id, title: d.title, posterUrl: d.posterUrl, year: d.year, rating: d.rating }, type);
  }

  // ── Detalles ──────────────────────────────────────────────────────────────

  async getMovie(id: string): Promise<MovieDetails> {
    const d = await this.metadata.movieDetails(String(id));
    // Prewarm: discovery en background para que la ficha tenga idiomas
    // y el Play posterior sea instantáneo. No bloquea la respuesta.
    void this.playback
      .prepare({ tmdbId: String(id), contentType: 'movie' })
      .catch(() => undefined);
    const knownLanguages = await this.registry
      .distinctLanguages(String(id), 'movie')
      .catch(() => [] as string[]);
    return { id: String(d.id), providerId: this.metadata.id, type: 'movie', title: d.title, originalTitle: d.originalTitle, overview: d.overview, posterUrl: d.posterUrl, backdropUrl: d.backdropUrl, year: d.year, rating: d.rating, genres: d.genres, runtimeMinutes: d.runtimeMinutes, languages: mergeLanguages(knownLanguages) };
  }

  async getSeries(id: string): Promise<SeriesDetails> {
    let d;
    try {
      d = await this.metadata.seriesDetails(String(id));
    } catch {
      const titleFromSlug = String(id).replace(/-/g, ' ').trim();
      const results = await this.metadata.searchSeries(titleFromSlug, 1);
      if (results.length === 0) throw new NotFoundException({ code: 'SERIES_NOT_FOUND' });
      d = await this.metadata.seriesDetails(results[0].id);
    }
    const seasonNumbers = d.seasons.map((s) => s.number);
    const episodesBySeason = await Promise.all(seasonNumbers.map((n) => this.metadata.seasonEpisodes(String(id), n).catch(() => [])));
    // Prewarm: discovery en background del E1 de la primera temporada real.
    // Así TODA serie tiene contenido conocido poco después de abrir su ficha.
    const firstSeason = seasonNumbers.find((n) => n >= 1) ?? 1;
    void this.playback
      .prepare({ tmdbId: String(id), contentType: 'series', season: firstSeason, episode: 1 })
      .catch(() => undefined);
    const knownLanguages = await this.registry
      .distinctLanguages(String(id), 'series')
      .catch(() => [] as string[]);
    return {
      id: String(d.id), providerId: this.metadata.id, type: 'series',
      title: d.title, originalTitle: d.originalTitle,
      overview: d.overview, posterUrl: d.posterUrl, backdropUrl: d.backdropUrl,
      year: d.year, rating: d.rating, genres: d.genres,
      languages: mergeLanguages(knownLanguages),
      seasons: seasonNumbers.map((number, i) => ({
        number,
        episodes: episodesBySeason[i].map((e) => ({
          id: e.id, season: e.season, number: e.number, title: e.title, imageUrl: e.stillUrl, overview: e.overview,
        })),
      })),
    };
  }

  async getSeasonEpisodes(id: string, season: number): Promise<Episode[]> {
    const res = await this.metadata.seasonEpisodes(String(id), season);
    return res.map((e) => ({ id: e.id, season: e.season, number: e.number, title: e.title, imageUrl: e.stillUrl, overview: e.overview }));
  }

  // ── Resolución con idiomas en paralelo ────────────────────────────────────

  /// Resuelve una película. Retorna TODOS los streams de TODOS los proveedores
  /// ordenados: español latino primero, luego otros idiomas.
  async resolveMovie(id: string): Promise<ResolvedStream[]> {
    // 1. CACHE HIT
    const cached = await this.streamResolution.findCached(String(id), 'movie', 'Español Latino');
    if (cached) {
      return [{ url: cached.resolvedUrl, kind: 'hls' as const, quality: cached.quality ?? 'auto', server: `${cached.language} · ${cached.serverName}`, providerId: cached.providerId }];
    }

    // 2. Resolver todos los proveedores EN PARALELO.
    const results = await Promise.allSettled(
      this.movieProviders.map(async (p): Promise<ResolvedStream[]> => {
        if (isTmdbKeyed(p)) return p.resolveMovieByTmdb(id);
        const details = await this.getMovie(id);
        const match = await this.findInProviderWithVariants(
          (q) => (p as MovieCatalogProvider).searchMovies(q, 1),
          [details.title, details.originalTitle], details.title, details.year,
        );
        if (!match) return [];
        return (p as MovieCatalogProvider).resolveMovie(match);
      }),
    );

    const allStreams = this.applyStreamTunnel(
      results
        .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .sort(this.sortByLangThenQuality),
    );

    if (allStreams.length === 0) {
      throw new NotFoundException({ code: 'NO_STREAMS_FOUND', triedProviders: this.movieProviders.map((p) => p.id), errors: results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)) });
    }

    // 3. Guardar cada resolución exitosa en cache global.
    for (const stream of allStreams) {
      const lang = stream.server?.split('·')[0]?.trim() ?? 'unknown';
      this.streamResolution.save({
        tmdbId: String(id), contentType: 'movie',
        resolvedUrl: stream.url.toString(), language: lang,
        providerId: stream.providerId ?? stream.server ?? '', serverName: stream.server ?? '',
        quality: stream.quality,
      }).catch(() => {});
    }

    return allStreams;
  }

  async resolveEpisode(id: string, season: number, episode: number): Promise<ResolvedStream[]> {
    // 1. CACHE HIT
    const cached = await this.streamResolution.findCached(String(id), 'series', 'Español Latino', season, episode);
    if (cached) {
      return [{ url: cached.resolvedUrl, kind: 'hls' as const, quality: cached.quality ?? 'auto', server: `${cached.language} · ${cached.serverName}`, providerId: cached.providerId }];
    }

    // 2. Resolver todos los proveedores EN PARALELO.
    const results = await Promise.allSettled(
      this.seriesProviders.map(async (p): Promise<ResolvedStream[]> => {
        if (isTmdbKeyed(p)) return p.resolveEpisodeByTmdb(id, season, episode);
        const details = await this.getSeries(id);
        const match = await this.findInProviderWithVariants(
          (q) => (p as SeriesCatalogProvider).searchSeries(`${q} temporada ${season}`, 1),
          [details.title, details.originalTitle], details.title, details.year,
        );
        if (!match) return [];
        return (p as SeriesCatalogProvider).resolveEpisode(match, season, episode);
      }),
    );

    const allStreams = this.applyStreamTunnel(
      results
        .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .sort(this.sortByLangThenQuality),
    );

    if (allStreams.length === 0) {
      throw new NotFoundException({ code: 'NO_STREAMS_FOUND', triedProviders: this.seriesProviders.map((p) => p.id), errors: results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)) });
    }

    // 3. Guardar cada resolución en cache global.
    for (const stream of allStreams) {
      const lang = stream.server?.split('·')[0]?.trim() ?? 'unknown';
      this.streamResolution.save({
        tmdbId: String(id), contentType: 'series', seasonNum: season, episodeNum: episode,
        resolvedUrl: stream.url.toString(), language: lang,
        providerId: stream.providerId ?? stream.server ?? '', serverName: stream.server ?? '',
        quality: stream.quality,
      }).catch(() => {});
    }

    return allStreams;
  }

  /// CDNs cuyos streams HLS llegan con lock de IP/ASN (el m3u8 solo sirve
  /// desde la IP que lo extrajo). Su tráfico debe tunelizarse por nuestro
  /// proxy (`stream/playlist?tunnel=1`) para reproducirse en el cliente.
  /// Envuelve los HLS de hosts con lock de red en el playlist-proxy del
  /// backend. Los MP4 de vidlink y demás fuentes directas quedan intactos.
  private applyStreamTunnel(streams: ResolvedStream[]): ResolvedStream[] {
    return streams.map((s) => {
      if (s.kind !== 'hls' || !needsTunnel(s.url)) return s;
      const wrapped = wrapPlaylistProxy(s.url, 'https://unlimplay.com/', { tunnel: true });
      return wrapped ? { ...s, url: wrapped, headers: undefined } : s;
    });
  }

  // NOTA: la tabla StreamResolution (resolvedUrl) quedó obsoleta con el
  // modelo v2: las URLs efímeras viven solo en PlaybackService.activeLeases
  // con expiración; en DB se persiste identidad estable (StreamSource).

  private sortByLangThenQuality(a: ResolvedStream, b: ResolvedStream): number {
    const labelA = (a.server ?? '').split('·')[0].trim().toLowerCase();
    const labelB = (b.server ?? '').split('·')[0].trim().toLowerCase();
    const ra = LANG_PRIORITY.indexOf(labelA) + 1 || 99;
    const rb = LANG_PRIORITY.indexOf(labelB) + 1 || 99;
    if (ra !== rb) return ra - rb;
    const qa = Number(a.quality?.replace(/\D/g, '')) || 0;
    const qb = Number(b.quality?.replace(/\D/g, '')) || 0;
    return qb - qa;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private toSummary(item: { id: string; title: string; posterUrl?: string; year?: number; rating?: number }, type: 'movie' | 'series'): ContentSummary {
    return { id: item.id, providerId: this.metadata.id, type, title: item.title, posterUrl: item.posterUrl, year: item.year, rating: item.rating };
  }

  private async fuzzySearch(kind: 'movie' | 'series', query: string): Promise<CatalogMetadataItem[]> {
    const normalized = normalizeText(query);
    if (!normalized) return [];
    const words = normalized.split(' ');
    const variants = new Set<string>([query]);
    variants.add(words.join(' '));
    if (words.length > 1) variants.add(words.slice(0, -1).join(' '));

    const search = kind === 'movie'
      ? (q: string) => this.metadata.searchMovies(q, 1)
      : (q: string) => this.metadata.searchSeries(q, 1);

    const seen = new Map<string, CatalogMetadataItem>();
    await Promise.allSettled([...variants].slice(0, 6).map(async (variant) => {
      try {
        for (const item of await search(variant)) {
          if (!seen.has(item.id)) seen.set(item.id, item);
        }
      } catch { return; }
    }));

    return [...seen.values()]
      .map((item) => {
        const itemNorm = normalizeText(item.title);
        const score = itemNorm.includes(normalized) ? 1 : similarity(normalized, item.title) * Math.min(1, itemNorm.length / Math.max(4, normalized.length));
        return { item, score };
      })
      .filter((s) => s.score >= 0.45)
      .sort((a, b) => b.score - a.score || (b.item.rating ?? 0) - (a.item.rating ?? 0))
      .map((s) => s.item);
  }

  private async findInProviderWithVariants(
    searchFn: (query: string) => Promise<Page<ContentSummary>>,
    titles: (string | undefined)[],
    referenceTitle: string,
    year?: number,
  ): Promise<string | null> {
    const variants = [...new Set(titles.filter((t): t is string => Boolean(t?.trim())))];
    for (const variant of variants) {
      try {
        const match = await this.findInProvider(() => searchFn(variant), referenceTitle, year);
        if (match) return match;
      } catch { continue; }
    }
    return null;
  }

  private async findInProvider(searchFn: () => Promise<Page<ContentSummary>>, title: string, year?: number): Promise<string | null> {
    const result = await searchFn();
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9áéíóúñü ]/g, '').trim();
    const candidates = result.items.filter((item) => {
      const itemTitle = item.title.toLowerCase();
      if (!itemTitle.includes(normalizedTitle) && !normalizedTitle.includes(itemTitle)) return false;
      if (year && item.year && Math.abs(item.year - year) > 1) return false;
      return true;
    });
    const chosen = candidates.find((c) => c.year === year) ?? candidates[0] ?? null;
    return chosen?.id ?? null;
  }
}



