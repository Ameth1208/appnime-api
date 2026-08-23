import { Injectable } from '@nestjs/common';
import { TtlCache, httpGetJson } from '../http/fetcher';
import type {
  CatalogMetadataEpisode,
  CatalogMetadataItem,
  MetadataProvider,
} from '../../domain/metadata-provider.interface';

const BASE = 'https://v3-cinemeta.strem.io';

interface CinemetaMeta {
  meta: {
    id: string;
    imdb_id?: string;
    name?: string;
    poster?: string;
    background?: string;
    releaseInfo?: string;
    imdbRating?: string;
    description?: string;
    genre?: string[];
    runtime?: string;
    videos?: { id: string; season: number; episode: number; name?: string; title?: string }[];
  };
}

interface CinemetaCatalog {
  metas: {
    id: string;
    name: string;
    poster?: string;
    releaseInfo?: string;
    imdbRating?: string;
  }[];
}

@Injectable()
export class CinemetaService implements MetadataProvider {
  readonly id = 'cinemeta';
  readonly enabled = true;
  private readonly cache = new TtlCache<unknown>(10 * 60 * 1000);

  private async get<T>(path: string): Promise<T> {
    return this.cache.wrap(path, () => httpGetJson<T>(`${BASE}${path}`)) as Promise<T>;
  }

  private yearFrom(releaseInfo?: string): number | undefined {
    const match = releaseInfo?.match(/(19|20)\d{2}/);
    return match ? Number(match[0]) : undefined;
  }

  private toItem(meta: CinemetaMeta['meta']): CatalogMetadataItem {
    return {
      id: meta.imdb_id ?? meta.id,
      title: meta.name ?? '',
      posterUrl: meta.poster,
      backdropUrl: meta.background,
      year: this.yearFrom(meta.releaseInfo),
      rating: meta.imdbRating ? Number(meta.imdbRating) : undefined,
      overview: meta.description,
    };
  }

  async catalog(type: 'movie' | 'series', page: number): Promise<CatalogMetadataItem[]> {
    const res = await this.get<CinemetaCatalog>(`/catalog/${type}/top/skip=${(page - 1) * 100}.json`);
    return (res.metas ?? []).map((m) => ({
      id: m.id,
      title: m.name,
      posterUrl: m.poster,
      year: this.yearFrom(m.releaseInfo),
      rating: m.imdbRating ? Number(m.imdbRating) : undefined,
    }));
  }

  moviesPopular(page: number): Promise<CatalogMetadataItem[]> {
    return this.catalog('movie', page);
  }

  seriesPopular(page: number): Promise<CatalogMetadataItem[]> {
    return this.catalog('series', page);
  }

  private async search(type: 'movie' | 'series', query: string, page: number): Promise<CatalogMetadataItem[]> {
    if (page > 1) return [];
    const res = await this.get<CinemetaCatalog>(
      `/catalog/${type}/top/search=${encodeURIComponent(query)}.json`,
    );
    return (res.metas ?? []).map((m) => ({ id: m.id, title: m.name, posterUrl: m.poster }));
  }

  searchMovies(query: string, page: number): Promise<CatalogMetadataItem[]> {
    return this.search('movie', query, page);
  }

  searchSeries(query: string, page: number): Promise<CatalogMetadataItem[]> {
    return this.search('series', query, page);
  }

  async movieDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; runtimeMinutes?: number }> {
    const res = await this.get<CinemetaMeta>(`/meta/movie/${id}.json`);
    const item = this.toItem(res.meta);
    return {
      ...item,
      genres: res.meta.genre ?? [],
      runtimeMinutes: Number(res.meta.runtime?.match(/\d+/)?.[0]) || undefined,
    };
  }

  async seriesDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; seasons: { number: number }[] }> {
    const res = await this.get<CinemetaMeta>(`/meta/series/${id}.json`);
    const item = this.toItem(res.meta);
    const seasonNumbers = [...new Set((res.meta.videos ?? []).map((v) => v.season))].filter((s) => s > 0).sort();
    return { ...item, genres: res.meta.genre ?? [], seasons: seasonNumbers.map((n) => ({ number: n })) };
  }

  async seasonEpisodes(id: string, season: number): Promise<CatalogMetadataEpisode[]> {
    const res = await this.get<CinemetaMeta>(`/meta/series/${id}.json`);
    return (res.meta.videos ?? [])
      .filter((v) => v.season === season)
      .map((v) => ({
        id: v.id,
        season: v.season,
        number: v.episode,
        title: v.name ?? v.title,
      }));
  }
}
