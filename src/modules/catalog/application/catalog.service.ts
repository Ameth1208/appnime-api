import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { CatalogSearchService } from '../infrastructure/search/catalog-search.service';
import type { AnyCatalogProvider } from '../infrastructure/providers/provider-factory';

export const MOVIE_PROVIDERS = 'CATALOG_MOVIE_PROVIDERS';
export const SERIES_PROVIDERS = 'CATALOG_SERIES_PROVIDERS';
export const METADATA_PROVIDER = 'CATALOG_METADATA_PROVIDER';

function isTmdbKeyed(provider: AnyCatalogProvider): provider is AnyCatalogProvider & TmdbKeyedProvider {
  return (provider as Partial<TmdbKeyedProvider>).supportsTmdbIds === true;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(MOVIE_PROVIDERS) private readonly movieProviders: AnyCatalogProvider[],
    @Inject(SERIES_PROVIDERS) private readonly seriesProviders: AnyCatalogProvider[],
    @Inject(METADATA_PROVIDER) private readonly metadata: MetadataProvider,
    private readonly searchEngine: CatalogSearchService,
  ) {}

  listProviders() {
    return {
      movies: this.movieProviders.map((p) => ({ id: p.id, displayName: p.displayName })),
      series: this.seriesProviders.map((p) => ({ id: p.id, displayName: p.displayName })),
      metadata: this.metadata.id,
    };
  }

  async moviesPopular(params: ListParams): Promise<Page<ContentSummary>> {
    const items = await this.metadata.moviesPopular(params.page);
    return {
      items: items.map((m) => this.toSummary(m, 'movie')),
      page: params.page,
      hasMore: items.length >= 20,
    };
  }

  async seriesPopular(params: ListParams): Promise<Page<ContentSummary>> {
    const items = await this.metadata.seriesPopular(params.page);
    return {
      items: items.map((m) => this.toSummary(m, 'series')),
      page: params.page,
      hasMore: items.length >= 20,
    };
  }

  async searchMovies(query: string, page: number): Promise<Page<ContentSummary>> {
    if (!query.trim()) return { items: [], page, hasMore: false };
    const meili = await this.searchEngine.search(query, 'movie');
    if (meili.length > 0) {
      return {
        items: meili.map((d) => this.docToSummary(d, 'movie')),
        page,
        hasMore: false,
      };
    }
    const items = await this.fuzzySearch('movie', query);
    return { items: items.map((m) => this.toSummary(m, 'movie')), page, hasMore: false };
  }

  async searchSeries(query: string, page: number): Promise<Page<ContentSummary>> {
    if (!query.trim()) return { items: [], page, hasMore: false };
    const meili = await this.searchEngine.search(query, 'series');
    if (meili.length > 0) {
      return {
        items: meili.map((d) => this.docToSummary(d, 'series')),
        page,
        hasMore: false,
      };
    }
    const items = await this.fuzzySearch('series', query);
    return { items: items.map((m) => this.toSummary(m, 'series')), page, hasMore: false };
  }

  private docToSummary(
    d: { id: string; title: string; posterUrl?: string; year?: number; rating?: number },
    type: 'movie' | 'series',
  ): ContentSummary {
    return this.toSummary(
      { id: d.id.includes(':') ? d.id.split(':')[1] : d.id, title: d.title, posterUrl: d.posterUrl, year: d.year, rating: d.rating },
      type,
    );
  }

  /// Búsqueda tolerante a errores tipográficos:
  /// consulta al proveedor de metadatos con varias variantes de la consulta
  /// y rankea los candidatos por similitud difusa contra el texto buscado.
  private async fuzzySearch(
    kind: 'movie' | 'series',
    query: string,
  ): Promise<CatalogMetadataItem[]> {
    const normalized = normalizeText(query);
    if (!normalized) return [];

    const words = normalized.split(' ');
    const variants = new Set<string>([query]);
    variants.add(words.join(' '));
    if (words.length > 1) {
      variants.add(words.slice(0, -1).join(' '));
      for (let i = 0; i < words.length; i++) {
        const withoutWord = words.filter((_, j) => j !== i).join(' ');
        if (withoutWord) variants.add(withoutWord);
      }
    }

    const search = kind === 'movie'
      ? (q: string) => this.metadata.searchMovies(q, 1)
      : (q: string) => this.metadata.searchSeries(q, 1);

    const seen = new Map<string, CatalogMetadataItem>();
    await Promise.allSettled(
      [...variants].slice(0, 8).map(async (variant) => {
        try {
          for (const item of await search(variant)) {
            if (!seen.has(item.id)) seen.set(item.id, item);
          }
        } catch {
          return;
        }
      }),
    );

    const scored = [...seen.values()]
      .map((item) => {
        const itemNorm = normalizeText(item.title);
        const score = itemNorm.includes(normalized)
          ? 1
          : similarity(normalized, item.title) * Math.min(1, itemNorm.length / Math.max(4, normalized.length));
        return { item, score };
      })
      .filter((s) => s.score >= 0.45)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.item.rating ?? 0) - (a.item.rating ?? 0),
      );

    return scored.map((s) => s.item);
  }

  async getMovie(id: string): Promise<MovieDetails> {
    const d = await this.metadata.movieDetails(String(id));
    return {
      id: String(d.id),
      providerId: this.metadata.id,
      type: 'movie',
      title: d.title,
      overview: d.overview,
      posterUrl: d.posterUrl,
      backdropUrl: d.backdropUrl,
      year: d.year,
      rating: d.rating,
      genres: d.genres,
      runtimeMinutes: d.runtimeMinutes,
    };
  }

  async getSeries(id: string): Promise<SeriesDetails> {
    const d = await this.metadata.seriesDetails(String(id));
    const seasonNumbers = d.seasons.map((s) => s.number);
    const episodesBySeason = await Promise.all(
      seasonNumbers.map((n) =>
        this.metadata.seasonEpisodes(String(id), n).catch(() => []),
      ),
    );
    return {
      id: String(d.id),
      providerId: this.metadata.id,
      type: 'series',
      title: d.title,
      overview: d.overview,
      posterUrl: d.posterUrl,
      backdropUrl: d.backdropUrl,
      year: d.year,
      rating: d.rating,
      genres: d.genres,
      seasons: seasonNumbers.map((number, i) => ({
        number,
        episodes: episodesBySeason[i].map((e) => ({
          id: e.id,
          season: e.season,
          number: e.number,
          title: e.title,
          imageUrl: e.stillUrl,
          overview: e.overview,
        })),
      })),
    };
  }

  async getSeasonEpisodes(id: string, season: number): Promise<Episode[]> {
    const res = await this.metadata.seasonEpisodes(String(id), season);
    return res.map((e) => ({
      id: e.id,
      season: e.season,
      number: e.number,
      title: e.title,
      imageUrl: e.stillUrl,
      overview: e.overview,
    }));
  }

  async resolveMovie(id: string): Promise<ResolvedStream[]> {
    const errors: string[] = [];
    for (const provider of this.movieProviders) {
      try {
        if (isTmdbKeyed(provider)) {
          const streams = await provider.resolveMovieByTmdb(id);
          if (streams.length > 0) return streams;
          continue;
        }
        const details = await this.getMovie(id);
        const match = await this.findInProvider(
          () => (provider as MovieCatalogProvider).searchMovies(details.title, 1),
          details.title,
          details.year,
        );
        if (!match) continue;
        const streams = await (provider as MovieCatalogProvider).resolveMovie(match);
        if (streams.length > 0) return streams;
      } catch (err) {
        errors.push(`${provider.id}: ${String(err)}`);
      }
    }
    throw new NotFoundException({
      code: 'NO_STREAMS_FOUND',
      triedProviders: this.movieProviders.map((p) => p.id),
      errors,
    });
  }

  async resolveEpisode(id: string, season: number, episode: number): Promise<ResolvedStream[]> {
    const errors: string[] = [];
    for (const provider of this.seriesProviders) {
      try {
        if (isTmdbKeyed(provider)) {
          const streams = await provider.resolveEpisodeByTmdb(id, season, episode);
          if (streams.length > 0) return streams;
          continue;
        }
        const details = await this.getSeries(id);
        const query = `${details.title} temporada ${season}`;
        const match = await this.findInProvider(() => (provider as SeriesCatalogProvider).searchSeries(query, 1), details.title, details.year);
        if (!match) continue;
        const streams = await (provider as SeriesCatalogProvider).resolveEpisode(match, season, episode);
        if (streams.length > 0) return streams;
      } catch (err) {
        errors.push(`${provider.id}: ${String(err)}`);
      }
    }
    throw new NotFoundException({
      code: 'NO_STREAMS_FOUND',
      triedProviders: this.seriesProviders.map((p) => p.id),
      errors,
    });
  }

  private toSummary(item: { id: string; title: string; posterUrl?: string; year?: number; rating?: number }, type: 'movie' | 'series'): ContentSummary {
    return {
      id: item.id,
      providerId: this.metadata.id,
      type,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
      rating: item.rating,
    };
  }

  private async findInProvider(searchFn: () => Promise<Page<ContentSummary>>, title: string, year?: number): Promise<string | null> {
    const result = await searchFn();
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9áéíóúñü ]/, '').trim();
    const candidates = result.items.filter((item) => {
      const itemTitle = item.title.toLowerCase();
      if (!itemTitle.includes(normalizedTitle) && !normalizedTitle.includes(itemTitle)) return false;
      if (year && item.year && Math.abs(item.year - year) > 1) return false;
      return true;
    });
    const chosen =
      candidates.find((c) => c.year === year) ??
      candidates.filter((c) => !year || !c.year || c.year === year)[0] ??
      result.items[0];
    return chosen?.id ?? null;
  }
}


