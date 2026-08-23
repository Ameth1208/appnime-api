import { Injectable } from '@nestjs/common';
import { TmdbService } from '../tmdb/tmdb.service';
import type {
  CatalogMetadataEpisode,
  CatalogMetadataItem,
  MetadataProvider,
} from '../../domain/metadata-provider.interface';

@Injectable()
export class TmdbMetadataAdapter implements MetadataProvider {
  readonly id = 'tmdb';
  readonly enabled: boolean;

  constructor(private readonly tmdb: TmdbService) {
    this.enabled = tmdb.enabled;
  }

  private toItem(item: {
    id: number;
    title?: string;
    name?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    vote_average?: number;
    release_date?: string;
    first_air_date?: string;
    overview?: string;
  }): CatalogMetadataItem {
    const yearRaw = item.release_date ?? item.first_air_date;
    return {
      id: String(item.id),
      title: item.title ?? item.name ?? '',
      posterUrl: this.tmdb.imageUrl(item.poster_path),
      backdropUrl: this.tmdb.imageUrl(item.backdrop_path, 'w780'),
      year: yearRaw ? Number(yearRaw.slice(0, 4)) : undefined,
      rating: item.vote_average,
      overview: item.overview,
    };
  }

  async moviesPopular(page: number): Promise<CatalogMetadataItem[]> {
    return (await this.tmdb.moviesPopular(page)).results.map((r) => this.toItem(r));
  }

  async seriesPopular(page: number): Promise<CatalogMetadataItem[]> {
    return (await this.tmdb.seriesPopular(page)).results.map((r) => this.toItem(r));
  }

  async searchMovies(query: string, page: number): Promise<CatalogMetadataItem[]> {
    return (await this.tmdb.movieSearch(query, page)).results.map((r) => this.toItem(r));
  }

  async searchSeries(query: string, page: number): Promise<CatalogMetadataItem[]> {
    return (await this.tmdb.seriesSearch(query, page)).results.map((r) => this.toItem(r));
  }

  async movieDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; runtimeMinutes?: number }> {
    const d = await this.tmdb.movieDetails(Number(id));
    return {
      ...this.toItem(d),
      genres: (d.genres ?? []).map((g) => g.name),
      runtimeMinutes: d.runtime ?? undefined,
    };
  }

  async seriesDetails(id: string): Promise<CatalogMetadataItem & { genres: string[]; seasons: { number: number }[] }> {
    const d = await this.tmdb.seriesDetails(Number(id));
    return {
      ...this.toItem(d),
      genres: (d.genres ?? []).map((g) => g.name),
      seasons: (d.seasons ?? [])
        .filter((s) => s.season_number > 0)
        .map((s) => ({ number: s.season_number })),
    };
  }

  async seasonEpisodes(id: string, season: number): Promise<CatalogMetadataEpisode[]> {
    const res = await this.tmdb.seasonEpisodes(Number(id), season);
    return res.episodes.map((e) => ({
      id: `${id}-${e.season_number}-${e.episode_number}`,
      season: e.season_number,
      number: e.episode_number,
      title: e.name,
      stillUrl: this.tmdb.imageUrl(e.still_path, 'w300'),
      overview: e.overview,
    }));
  }
}
