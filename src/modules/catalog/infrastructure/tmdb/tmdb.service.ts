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
  adult?: boolean;
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
  private _adultMode = false;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('TMDB_API_KEY') ?? '';
  }

  set adultMode(value: boolean) {
    this._adultMode = value;
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams({
      api_key: this.apiKey,
      language: 'es-MX',
      include_adult: this._adultMode ? 'true' : 'false',
      ...params,
    });
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

  /// Anime: animación japonesa ordenada por popularidad.
  ///
  /// without_keywords bloquea contenido adulto/hentai por keyword de TMDB:
  /// 198385 hentai · 378816, 298666 (sexuales) · 445 pornography ·
  /// 356759 porn · 155139 porn parody · 7344 porn star · 238355 gay porn ·
  /// 347060 explicite sex · 256466 erotic · 267122 sex · 284535 adult video
  private static readonly ADULT_KEYWORDS =
    '198385,378816,298666,445,356759,155139,7344,238355,347060,256466,267122,284535';

  async seriesAnime(page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/discover/tv', {
      page: String(page),
      with_genres: '16',
      with_original_language: 'ja',
      without_keywords: TmdbService.ADULT_KEYWORDS,
      sort_by: 'popularity.desc',
      'vote_count.gte': '20',
    });
  }

  /// Búsqueda de anime dentro del catálogo de animación japonesa.
  async seriesAnimeSearch(query: string, page: number): Promise<TmdbPage<RawTmdbItem>> {
    return this.get<TmdbPage<RawTmdbItem>>('/search/tv', {
      query,
      page: String(page),
      with_genres: '16',
      with_original_language: 'ja',
      without_keywords: TmdbService.ADULT_KEYWORDS,
    });
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










