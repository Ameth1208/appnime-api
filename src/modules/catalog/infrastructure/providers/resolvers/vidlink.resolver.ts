import { Injectable } from '@nestjs/common';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import { VidlinkTokenEngine } from '../vidlink/vidlink-token.engine';
import { leaseTtl, type ServerResolver } from './server-resolver';

const VIDLINK_BASE = 'https://vidlink.pro';
const PROXY_BASE = 'https://noon.mooncase.online/';

interface VidlinkQuality {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  requiresProxy?: boolean;
}

interface VidlinkResponse {
  stream?: {
    playlist?: string;
    requiresProxy?: boolean;
    headers?: Record<string, string>;
    qualities?: Record<string, VidlinkQuality>;
  };
}

/**
 * Resuelve fuentes vidlink vía token engine (wasm). La fuente conocida solo
 * necesita tmdbId/season/episode — vidlink es TMDB-keyed.
 */
@Injectable()
export class VidlinkSourceResolver implements ServerResolver {
  private readonly engine = new VidlinkTokenEngine();

  supports(providerId: string): boolean {
    return providerId === 'vidlink';
  }

  async resolve(source: SourceCandidate): Promise<PlaybackLease[]> {
    const id = source.tmdbId;
    const path =
      source.contentType === 'movie'
        ? `/api/b/movie/${encodeURIComponent(await this.token(id))}?multiLang=1`
        : `/api/b/tv/${encodeURIComponent(await this.token(id))}/${source.seasonNum}/${source.episodeNum}?multiLang=1`;

    const res = await fetch(`${VIDLINK_BASE}${path}`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'x-playback-environment': 'standard',
        referer: 'https://vidlink.pro/',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`vidlink HTTP ${res.status}`);
    const text = await res.text();
    const json = text.trim() ? (JSON.parse(text) as VidlinkResponse) : null;
    if (!json?.stream) return [];

    const leases: PlaybackLease[] = [];
    const expiresAt = leaseTtl('vidlink');

    if (typeof json.stream.playlist === 'string') {
      const locked = json.stream.requiresProxy === true;
      leases.push({
        url: locked
          ? this.proxyUrl(json.stream.playlist, json.stream.headers ?? {})
          : json.stream.playlist,
        kind: 'hls',
        quality: 'auto',
        delivery: locked ? 'playlist_proxy' : 'direct',
        headers: locked ? undefined : json.stream.headers,
        expiresAt,
      });
    }

    for (const [quality, q] of Object.entries(json.stream.qualities ?? {})) {
      if (q.type !== 'mp4' || !q.url) continue;
      leases.push({
        url: q.url,
        kind: 'mp4',
        quality: quality.endsWith('p') ? quality : `${quality}p`,
        delivery: 'direct',
        headers:
          Object.keys(q.headers ?? {}).length > 0
            ? q.headers
            : { 'user-agent': 'Lavf/60.3.100' },
        expiresAt,
      });
      if (q.requiresProxy === true) {
        leases.push({
          url: this.proxyUrl(q.url, q.headers ?? {}),
          kind: 'mp4',
          quality: quality.endsWith('p') ? quality : `${quality}p`,
          delivery: 'playlist_proxy',
          expiresAt,
        });
      }
    }

    // Mejor calidad primero.
    const rank = (q?: string): number => Number(q?.replace(/\D/g, '')) || 0;
    return leases.sort((a, b) => rank(b.quality) - rank(a.quality));
  }

  private async token(id: string): Promise<string> {
    return this.engine.getToken(id);
  }

  /// Réplica del algoritmo del player de vidlink para su proxy público.
  private proxyUrl(rawUrl: string, headers: Record<string, string>): string {
    const url = new URL(rawUrl);
    const filtered: string[] = [];
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'headers' || key === 'host') continue;
      filtered.push(`${key}=${value}`);
    }
    const sortedHeaders = JSON.stringify(
      Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))),
    );
    const b64url = Buffer.from(sortedHeaders, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const host = encodeURIComponent(url.origin);
    return `${PROXY_BASE}mp${url.pathname}?${[...filtered, `headers=${b64url}`, `host=${host}`].join('&')}`;
  }
}
