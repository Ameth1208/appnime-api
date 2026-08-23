export type ContentType = 'movie' | 'series';

export interface ContentSummary {
  id: string;
  providerId: string;
  type: ContentType;
  title: string;
  posterUrl?: string;
  year?: number;
  rating?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

export interface MovieDetails extends ContentSummary {
  languages?: string[];
  originalTitle?: string;
  overview?: string;
  backdropUrl?: string;
  genres: string[];
  runtimeMinutes?: number;
}

export interface Episode {
  id: string;
  season: number;
  number: number;
  title?: string;
  imageUrl?: string;
  overview?: string;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface SeriesDetails extends ContentSummary {
  languages?: string[];
  originalTitle?: string;
  overview?: string;
  backdropUrl?: string;
  genres: string[];
  seasons: Season[];
}

export interface ResolvedStream {
  url: string;
  kind: 'hls' | 'mp4' | 'embed';
  quality?: string;
  server: string;
  providerId: string;
  headers?: Record<string, string>;
}

export interface ListParams {
  page: number;
}

export interface CatalogProviderMeta {
  readonly id: string;
  readonly displayName: string;
  readonly supportedTypes: ContentType[];
}

export interface MovieCatalogProvider extends CatalogProviderMeta {
  listMovies(params: ListParams): Promise<Page<ContentSummary>>;
  searchMovies(query: string, page: number): Promise<Page<ContentSummary>>;
  getMovie(id: string): Promise<MovieDetails>;
  resolveMovie(id: string): Promise<ResolvedStream[]>;
}

export interface SeriesCatalogProvider extends CatalogProviderMeta {
  listSeries(params: ListParams): Promise<Page<ContentSummary>>;
  searchSeries(query: string, page: number): Promise<Page<ContentSummary>>;
  getSeries(id: string): Promise<SeriesDetails>;
  getSeasonEpisodes(id: string, season: number): Promise<Episode[]>;
  resolveEpisode(id: string, season: number, episode: number): Promise<ResolvedStream[]>;
}

export interface TmdbKeyedProvider {
  readonly supportsTmdbIds: true;
  resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]>;
  resolveEpisodeByTmdb(id: number | string, season: number, episode: number): Promise<ResolvedStream[]>;
}


