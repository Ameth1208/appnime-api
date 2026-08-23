import { Injectable } from '@nestjs/common';
import { defaultExtractors, extractWithFallback, GenericMediaExtractor } from '../../extractors';
import type { ContentType, ResolvedStream, TmdbKeyedProvider } from '../../../domain/types';

interface EmbedSource {
  id: string;
  movieUrl: (id: string) => string;
  tvUrl: (id: string, season: number, episode: number) => string;
}

const DEFAULT_SOURCES = 'vidsrc.xyz,autoembed,multiembed,vidlink';

const isImdb = (id: string) => id.startsWith('tt');

const EMBED_SOURCES: EmbedSource[] = [
  {
    id: 'vidsrc.xyz',
    movieUrl: (id: string) =>
      isImdb(id)
        ? `https://vidsrc.xyz/embed/movie?imdb=${id}`
        : `https://vidsrc.xyz/embed/movie?tmdb=${id}`,
    tvUrl: (id: string, s: number, e: number) =>
      isImdb(id)
        ? `https://vidsrc.xyz/embed/tv?imdb=${id}&season=${s}&episode=${e}`
        : `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
  {
    id: 'autoembed',
    movieUrl: (id: string) =>
      isImdb(id) ? `https://autoembed.cc/embed/movie/${id}` : `https://autoembed.co/embed/movie/${id}`,
    tvUrl: (id: string, s: number, e: number) =>
      isImdb(id) ? `https://autoembed.cc/embed/tv/${id}-${s}-${e}` : `https://autoembed.co/embed/tv/${id}-${s}-${e}`,
  },
  {
    id: 'multiembed',
    movieUrl: (id: string) => `https://multiembed.mov/?video_id=${id}${isImdb(id) ? '' : '&tmdb=1'}`,
    tvUrl: (id: string, s: number, e: number) =>
      `https://multiembed.mov/?video_id=${id}&s=${s}&e=${e}${isImdb(id) ? '' : '&tmdb=1'}`,
  },
  {
    id: 'vidlink',
    movieUrl: (id: string) => `https://vidlink.pro/movie/${id}`,
    tvUrl: (id: string, s: number, e: number) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
];

@Injectable()
export class MultiApiCatalogProvider implements TmdbKeyedProvider {
  readonly supportsTmdbIds = true as const;
  readonly supportedTypes: ContentType[] = ['movie', 'series'];
  private readonly sources: EmbedSource[];
  private readonly genericExtractor = new GenericMediaExtractor();

  constructor(sourcesEnv?: string) {
    const enabled = (sourcesEnv ?? DEFAULT_SOURCES)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    this.sources = EMBED_SOURCES.filter((s) => enabled.includes(s.id));
  }

  get id(): string {
    return 'multiapi';
  }

  get displayName(): string {
    return 'MultiAPI';
  }

  async resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]> {
    for (const source of this.sources) {
      const streams = await this.resolveEmbed(source.id, source.movieUrl(String(id)));
      if (streams.length > 0) return streams;
    }
    return [];
  }

  async resolveEpisodeByTmdb(id: number | string, season: number, episode: number): Promise<ResolvedStream[]> {
    for (const source of this.sources) {
      const streams = await this.resolveEmbed(source.id, source.tvUrl(String(id), season, episode));
      if (streams.length > 0) return streams;
    }
    return [];
  }

  private async resolveEmbed(sourceId: string, embedUrl: string): Promise<ResolvedStream[]> {
    let streams = await this.genericExtractor.resolve(embedUrl, sourceId);
    if (streams.length > 0) return streams;
    streams = await extractWithFallback([{ label: sourceId, url: embedUrl }], defaultExtractors(), sourceId);
    return streams.filter((s) => s.kind !== 'embed');
  }
}


