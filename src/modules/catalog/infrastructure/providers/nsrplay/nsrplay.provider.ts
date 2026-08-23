import { Injectable } from '@nestjs/common';
import type { ContentType, ResolvedStream, TmdbKeyedProvider } from '../../../domain/types';

const NSRPLAY = 'https://nsrplay.space';
const UA = { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'application/json' };

interface NsrServer {
  name: string;
  server: string;
  language: string;
  token: string;
  directResolveEligible?: boolean;
}

interface NsrResolveData {
  directUrl?: string;
  streamToken?: string;
  playUrl?: string;
}

@Injectable()
export class NsrPlayCatalogProvider implements TmdbKeyedProvider {
  readonly supportsTmdbIds = true as const;
  readonly supportedTypes: ('movie' | 'series')[] = ['movie', 'series'];
  private readonly cache = new Map<string, { streams: ResolvedStream[]; at: number }>();

  get id(): string {
    return 'nsrplay';
  }

  get displayName(): string {
    return 'NSRPlay Latino';
  }

  async resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]> {
    return this.withCache(`m:${id}`, () =>
      this.resolve(`${NSRPLAY}/api/v1/embed/sources/movie/${id}`),
    );
  }

  async resolveEpisodeByTmdb(
    id: number | string,
    season: number,
    episode: number,
  ): Promise<ResolvedStream[]> {
    return this.withCache(`t:${id}:${season}:${episode}`, () =>
      this.resolve(`${NSRPLAY}/api/v1/embed/sources/tv/${id}/${season}/${episode}`),
    );
  }

  private async withCache(
    key: string,
    fn: () => Promise<ResolvedStream[]>,
  ): Promise<ResolvedStream[]> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.streams;
    const streams = await fn();
    if (streams.length > 0) this.cache.set(key, { streams, at: Date.now() });
    return streams;
  }

  private async resolve(sourcesUrl: string): Promise<ResolvedStream[]> {
    const res = await fetch(sourcesUrl, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`nsrplay sources HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; servers?: NsrServer[] };
    const servers = json.servers ?? [];
    if (servers.length === 0) throw new Error('nsrplay: no servers');

    const langPriority = ['español latino', 'latino', 'español', 'castellano', 'subtitulado'];

    // Filtrar elegibles, ordenar latino primero, máximo 4.
    const eligible = [...servers]
      .filter((s) => s.directResolveEligible && s.token)
      .sort(
        (a, b) =>
          (langPriority.indexOf(a.language.toLowerCase()) + 1 || 99) -
          (langPriority.indexOf(b.language.toLowerCase()) + 1 || 99),
      )
      .slice(0, 4);

    if (eligible.length === 0) return [];

    // Resolver en paralelo.
    const results = await Promise.allSettled(
      eligible.map(async (server): Promise<ResolvedStream> => {
        const resolveRes = await fetch(
          `${NSRPLAY}/api/v1/embed/resolve?token=${server.token}`,
          { headers: UA, signal: AbortSignal.timeout(15000) },
        );
        if (!resolveRes.ok) throw new Error(`HTTP ${resolveRes.status}`);
        const rj = (await resolveRes.json()) as { success?: boolean; data?: NsrResolveData };
        if (!rj.success || !rj.data?.playUrl) throw new Error('no playUrl');
        return {
          url: rj.data.playUrl,
          kind: 'hls',
          quality: 'auto',
          server: `${server.language} · ${server.name}`,
          providerId: this.id,
        };
      }),
    );

    const streams = results
      .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      .sort((a, b) => {
        const la = langPriority.indexOf((a.server ?? '').split(' · ')[0].toLowerCase()) + 1 || 99;
        const lb = langPriority.indexOf((b.server ?? '').split(' · ')[0].toLowerCase()) + 1 || 99;
        return la - lb;
      });

    return streams;
  }
}
