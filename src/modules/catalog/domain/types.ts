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
  language?: string;
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




// ── Modelo de resolución v2: discover/resolve separados ─────────────────────

export type StreamDelivery = 'direct' | 'playlist_proxy' | 'tunnel';

/// Fuente descubierta en un provider. Identidad estable, SIN URLs efímeras.
export interface DiscoveredSource {
  languageCode: string;
  languageName: string;
  providerId: string;
  serverId: string;
  /// Dato del provider para re-resolver sin búsqueda (embed URL, slug, etc).
  providerItemId?: string;
  providerUrl?: string;
  quality?: string;
  hasSubs?: boolean;
  subLanguages?: string[];
  deliveryMode: StreamDelivery;
}

/// URL fresca + metadata de playback. Vida corta (segundos/minutos).
/// Pista de subtítulos externa asociada a un stream.
export interface SubtitleTrack {
  language: string; // código ISO si se conoce ("es", "en"), si no etiqueta
  title?: string;
  url: string;
}

export interface PlaybackLease {
  url: string;
  kind: 'hls' | 'mp4';
  headers?: Record<string, string>;
  quality?: string;
  delivery: StreamDelivery;
  expiresAt?: Date;
  subtitles?: SubtitleTrack[];
}

/// Input estándar para discovery.
export interface DiscoverInput {
  tmdbId: string;
  contentType: ContentType | 'anime';
  season?: number;
  episode?: number;
}

/// DiscoveredSource ya resuelta contra un contenido concreto
/// (lista para persistir en StreamSource).
export interface ProviderDiscoveredSource extends DiscoveredSource {
  tmdbId: string;
  contentType: string;
  seasonNum: number;
  episodeNum: number;
}
