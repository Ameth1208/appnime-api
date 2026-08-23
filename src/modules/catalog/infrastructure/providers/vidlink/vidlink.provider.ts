import { execFile } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import type { ContentType, ResolvedStream, TmdbKeyedProvider } from '../../../domain/types';
import { TtlCache } from '../../http/fetcher';
import { VidlinkTokenEngine } from './vidlink-token.engine';

const VIDLINK_BASE = 'https://vidlink.pro';
const PROXY_BASE = 'https://noon.mooncase.online/';

interface VidlinkQuality {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  requiresProxy?: boolean;
}

interface VidlinkResponse {
  stream?: VidlinkStream;
}

interface VidlinkStream {
  playlist?: string;
  deliveryType?: string;
  requiresProxy?: boolean;
  headers?: Record<string, string>;
  qualities?: Record<string, VidlinkQuality>;
}

@Injectable()
export class VidlinkCatalogProvider implements TmdbKeyedProvider {
  readonly supportsTmdbIds = true as const;
  readonly supportedTypes: ContentType[] = ['movie', 'series'];
  private readonly engine = new VidlinkTokenEngine();

  /// Streams resueltos (10 min): evita re-golpear vidlink al cambiar de
  /// episodio y volver, y absorbe los picos de fallo del API.
  private readonly resolved = new TtlCache<ResolvedStream[]>(10 * 60 * 1000);

  /// Última versión conocida de cada resolución con su momento de obtención.
  /// Si vidlink está caído se sirve esto antes que "sin fuentes", pero solo
  /// mientras los MP4 firmados puedan seguir vivos (TTL del CDN ≈ 1h).
  private readonly lastKnown = new Map<string, { streams: ResolvedStream[]; at: number }>();

  private static readonly STALE_LIMIT_MS = 45 * 60 * 1000;

  get id(): string {
    return 'vidlink';
  }

  get displayName(): string {
    return 'Vidlink';
  }

  async resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]> {
    const key = `m:${id}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;
    try {
      const streams = await this.withRetry(() => this.resolveMovieOnce(id));
      this.lastKnown.set(key, { streams, at: Date.now() });
      this.resolved.set(key, streams);
      return streams;
    } catch (err) {
      const staleEntry = this.lastKnown.get(key);
      const stale = staleEntry && Date.now() - staleEntry.at < VidlinkCatalogProvider.STALE_LIMIT_MS ? staleEntry.streams : undefined;
      if (stale?.length) {
        this.loggerWarn(`vidlink caído para ${key}; sirviendo última resolución conocida`);
        return stale;
      }
      throw err;
    }
  }

  async resolveEpisodeByTmdb(
    id: number | string,
    season: number,
    episode: number,
  ): Promise<ResolvedStream[]> {
    const key = `t:${id}:${season}:${episode}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;
    try {
      const streams = await this.withRetry(() =>
        this.resolveEpisodeOnce(id, season, episode),
      );
      this.lastKnown.set(key, { streams, at: Date.now() });
      this.resolved.set(key, streams);
      return streams;
    } catch (err) {
      const staleEntry = this.lastKnown.get(key);
      const stale = staleEntry && Date.now() - staleEntry.at < VidlinkCatalogProvider.STALE_LIMIT_MS ? staleEntry.streams : undefined;
      if (stale?.length) {
        this.loggerWarn(`vidlink caído para ${key}; sirviendo última resolución conocida`);
        return stale;
      }
      throw err;
    }
  }

  private loggerWarn(msg: string): void {
    // Logger ligero para no acoplar el provider a Nest DI en pruebas.
    console.warn(`[VidlinkCatalogProvider] ${msg}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /// Vidlink tiene ráfagas de fallo largas: 5 intentos con backoff
  /// progresivo (~15s totales) antes de rendirse.
  private async withRetry(
    fn: () => Promise<ResolvedStream[]>,
  ): Promise<ResolvedStream[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const streams = await fn();
        if (streams.length > 0) return streams;
        lastError = new Error('respuesta vacía');
      } catch (err) {
        lastError = err;
      }
      if (attempt < 5) await this.sleep(600 * attempt);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async resolveMovieOnce(id: number | string): Promise<ResolvedStream[]> {
    const token = await this.engine.getToken(String(id));
    const res = await this.curlJson<VidlinkResponse | null>(
      `${VIDLINK_BASE}/api/b/movie/${encodeURIComponent(token)}?multiLang=1`,
    );
    return this.mapStreams(res, `movie:${id}`);
  }

  private async resolveEpisodeOnce(
    id: number | string,
    season: number,
    episode: number,
  ): Promise<ResolvedStream[]> {
    const token = await this.engine.getToken(String(id));
    const res = await this.curlJson<VidlinkResponse | null>(
      `${VIDLINK_BASE}/api/b/tv/${encodeURIComponent(token)}/${season}/${episode}?multiLang=1`,
    );
    return this.mapStreams(res, `tv:${id}:${season}:${episode}`);
  }

  private curlJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      execFile(
        'curl',
        [
          '-s', '--max-time', '20', '--compressed',
          '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          '-H', 'x-playback-environment: standard',
          '-H', 'referer: https://vidlink.pro/',
          url,
        ],
        { timeout: 25000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(new Error(`vidlink request failed: ${err.message}`));
          try {
            const parsed = stdout.trim() ? (JSON.parse(stdout) as T) : (null as unknown as T);
            resolve(parsed);
          } catch {
            reject(new Error('vidlink invalid response'));
          }
        },
      );
    });
  }

  private mapStreams(res: VidlinkResponse | null | undefined, ref: string): ResolvedStream[] {
    const stream = res?.stream;
    if (!stream) return [];
    const streams: ResolvedStream[] = [];

    if (typeof stream.playlist === 'string') {
      streams.push({
        url: stream.requiresProxy === true
          ? this.proxyUrl(stream.playlist, stream.headers ?? {})
          : stream.playlist,
        kind: 'hls',
        quality: 'auto',
        server: 'Inglés · vidlink-hls',
        providerId: this.id,
        headers: stream.headers,
      });
    }

    for (const [quality, q] of Object.entries(stream.qualities ?? {})) {
      if (q.type !== 'mp4' || !q.url) continue;
      streams.push({
        url: q.url,
        kind: 'mp4',
        quality: quality.endsWith('p') ? quality : `${quality}p`,
        server: 'Inglés · vidlink-mp4',
        providerId: this.id,
        headers: Object.keys(q.headers ?? {}).length > 0 ? q.headers : { 'user-agent': 'Lavf/60.3.100' },
      });
      if (q.requiresProxy === true) {
        streams.push({
          url: this.proxyUrl(q.url, q.headers ?? {}),
          kind: 'mp4',
          quality: quality.endsWith('p') ? quality : `${quality}p`,
          server: 'Inglés · vidlink-proxy',
          providerId: this.id,
        });
      }
    }
    void ref;
    // Mejor calidad primero para que el player intente 1080p antes que 360p.
    const qualityRank = (q?: string): number => Number(q?.replace(/\D/g, '')) || 0;
    return streams.sort(
      (a, b) => qualityRank(b.quality) - qualityRank(a.quality),
    );
  }

  /// Réplica del algoritmo de reescritura del player de vidlink:
  /// `{proxy}/mp{pathname}?{query filtrada}&headers={b64url json}&host={origin}`
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

  private headers(): Record<string, string> {
    return {
      'x-playback-environment': 'standard',
      referer: `${VIDLINK_BASE}/`,
    };
  }
}




