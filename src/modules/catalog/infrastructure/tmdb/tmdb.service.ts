import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache, httpGetJson } from '../http/fetcher';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface TmdbPage<T> {
  page: number;
  results: T[];
  total_pages: number;
}

export interface RawTmdbItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  popularity?: number;
  genre_ids?: number[];
}

interface RawTmdbDetail extends RawTmdbItem {
  original_title?: string;
  original_name?: string;
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  episode_run_time?: number[];
  seasons?: { season_number: number; episode_count: number; name: string }[];
}

export interface RawEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name?: string;
  still_path?: string | null;
  overview?: string;
}

@Injectable()
export class TmdbService {
  private readonly apiKey: string;
  private readonly cache = new TtlCache<unknown>(10 * 60 * 1000);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('TMDB_API_KEY') ?? '';
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams({ api_key: this.apiKey, language: 'es-MX', ...params });
    const url = `${TMDB_BASE}${path}?${query.toString()}`;
    return this.cache.wrap(url, () => httpGetJson<T>(url)) as Promise<T>;
  }

  imageUrl(path: string | null | undefined, size = 'w500'): string | undefined {
    return path ? `${IMAGE_BASE}/${size}${path}` : undefined;
  }

  yearOf(item: RawTmdbItem): number | undefined {
    const date = item.release_date ?? item.first_air_date;
    if (!date) return undefined;
    const parsed = Number(date.slice(0, 4));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  moviesPopular(page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/movie/popular', { page: String(page) });
  }

  moviesTopRated(page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/movie/top_rated', { page: String(page) });
  }

  seriesPopular(page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/tv/popular', { page: String(page) });
  }

  seriesTopRated(page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/tv/top_rated', { page: String(page) });
  }

  movieSearch(query: string, page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/search/movie', { query, page: String(page) });
  }

  seriesSearch(query: string, page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/search/tv', { query, page: String(page) });
  }

  movieDetails(id: number): Promise<RawTmdbDetail> {
    return this.get<RawTmdbDetail>(`/movie/${id}`);
  }

  seriesDetails(id: number): Promise<RawTmdbDetail> {
    return this.get<RawTmdbDetail>(`/tv/${id}`);
  }

  seasonEpisodes(id: number, season: number): Promise<{ episodes: RawEpisode[] }> {
    return this.get<{ episodes: RawEpisode[] }>(`/tv/${id}/season/${season}`);
  }
}





