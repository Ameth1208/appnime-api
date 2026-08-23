export interface CatalogMetadataItem {
  originalTitle?: string;
  id: string;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  year?: number;
  rating?: number;
  overview?: string;
  genreIds?: number[];
}

export interface CatalogMetadataSeason {
  number: number;
}

export interface CatalogMetadataEpisode {
  id: string;
  season: number;
  number: number;
  title?: string;
  stillUrl?: string;
  overview?: string;
}

export interface MetadataProvider {
  readonly id: string;
  readonly enabled: boolean;
  moviesPopular(page: number): Promise<CatalogMetadataItem[]>;
  seriesPopular(page: number): Promise<CatalogMetadataItem[]>;
  searchMovies(query: string, page: number): Promise<CatalogMetadataItem[]>;
  searchSeries(query: string, page: number): Promise<CatalogMetadataItem[]>;
  movieDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; runtimeMinutes?: number }>;
  seriesDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; seasons: CatalogMetadataSeason[] }>;
  seasonEpisodes(id: string, season: number): Promise<CatalogMetadataEpisode[]>;
}


