import { Injectable } from '@nestjs/common';
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
} from '../../../domain/types';
import { JkanimeCatalogService } from './jkanime-catalog.service';

@Injectable()
export class JkAnimeAdapter implements MovieCatalogProvider, SeriesCatalogProvider {
  readonly supportedTypes: ('movie' | 'series')[] = ['movie', 'series'];

  constructor(private readonly jk: JkanimeCatalogService) {}

  get id(): string {
    return 'jkanime';
  }

  get displayName(): string {
    return 'JKAnime';
  }

  private toSummary(
    i: { id: string; title: string; imageUrl?: string },
    type: 'movie' | 'series' = 'series',
  ): ContentSummary {
    return { id: i.id, providerId: this.id, type, title: i.title, posterUrl: i.imageUrl };
  }

  async searchSeries(query: string, page: number): Promise<Page<ContentSummary>> {
    const items = await this.jk.search(query);
    return { items: items.map((i) => this.toSummary(i)), page, hasMore: false };
  }

  async searchMovies(query: string, page: number): Promise<Page<ContentSummary>> {
    return this.searchSeries(query, page);
  }

  async listSeries(_params: ListParams): Promise<Page<ContentSummary>> {
    const items = await this.jk.popular();
    return { items: items.map((i) => this.toSummary(i)), page: _params.page, hasMore: false };
  }

  async listMovies(_params: ListParams): Promise<Page<ContentSummary>> {
    return this.listSeries(_params);
  }

  async getSeries(id: string): Promise<SeriesDetails> {
    const d = await this.jk.details(id);
    const episodes = await this.jk.episodes(id);
    return {
      id,
      providerId: this.id,
      type: 'series',
      title: d.title,
      originalTitle: d.title,
      overview: d.description,
      posterUrl: d.imageUrl,
      genres: [],
      languages: ['Español Latino', 'Subtitulado'],
      seasons: [
        {
          number: 1,
          episodes: episodes.map((e) => ({
            id: e.url,
            number: e.number,
            title: e.title,
            season: 1,
          })),
        },
      ],
    };
  }

  async getSeasonEpisodes(id: string): Promise<Episode[]> {
    return this.jk.episodes(id).then((eps) =>
      eps.map((e) => ({ id: e.url, number: e.number, title: e.title, season: 1 })),
    );
  }

  async resolveEpisode(id: string, _season: number, episode: number): Promise<ResolvedStream[]> {
    const url = await this.jk.resolveEpisode(id, episode);
    if (!url) throw new Error('jkanime: no stream found');
    return [
      {
        url,
        kind: url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
        quality: 'auto',
        server: 'jkanime',
        providerId: this.id,
        headers: { referer: `https://jkanime.net/${id}/${episode}/` },
      },
    ];
  }

  async resolveMovie(id: string): Promise<ResolvedStream[]> {
    return this.resolveEpisode(id, 1, 1);
  }

  async getMovie(id: string): Promise<MovieDetails> {
    const d = await this.jk.details(id);
    return {
      id,
      providerId: this.id,
      type: 'movie',
      title: d.title,
      overview: d.description,
      posterUrl: d.imageUrl,
      genres: [],
    };
  }
}

