import { Injectable } from '@nestjs/common';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import { leaseTtl, type ServerResolver } from './server-resolver';

const NSRPLAY = 'https://nsrplay.space';
const UA = { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'application/json' };

interface NsrResolveData {
  playUrl?: string;
}

/**
 * Resuelve fuentes nsrplay. La API es rápida y por token efímero: se
 * re-consulta `sources` y se busca el servidor guardado en la fuente.
 */
@Injectable()
export class NsrPlaySourceResolver implements ServerResolver {
  supports(providerId: string): boolean {
    return providerId === 'nsrplay';
  }

  async resolve(source: SourceCandidate): Promise<PlaybackLease[]> {
    const sourcesUrl =
      source.contentType === 'movie'
        ? `${NSRPLAY}/api/v1/embed/sources/movie/${source.tmdbId}`
        : `${NSRPLAY}/api/v1/embed/sources/tv/${source.tmdbId}/${source.seasonNum}/${source.episodeNum}`;

    const res = await fetch(sourcesUrl, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`nsrplay sources HTTP ${res.status}`);
    const json = (await res.json()) as {
      servers?: { name: string; language: string; token: string; directResolveEligible?: boolean }[];
    };
    const server = (json.servers ?? []).find(
      (s) =>
        s.token &&
        s.directResolveEligible &&
        (s.name === source.serverId || source.providerItemId === s.name),
    );
    if (!server) throw new Error(`nsrplay: server ${source.serverId} ya no disponible`);

    const resolveRes = await fetch(
      `${NSRPLAY}/api/v1/embed/resolve?token=${server.token}`,
      { headers: UA, signal: AbortSignal.timeout(15000) },
    );
    if (!resolveRes.ok) throw new Error(`nsrplay resolve HTTP ${resolveRes.status}`);
    const rj = (await resolveRes.json()) as { success?: boolean; data?: NsrResolveData };
    if (!rj.success || !rj.data?.playUrl) throw new Error('nsrplay sin playUrl');

    return [
      {
        // nsrplay siempre vía playlist-proxy propio (su CDN requiere referer).
        url: wrapPlaylistOrThrow(rj.data.playUrl),
        kind: 'hls',
        quality: source.quality ?? 'auto',
        delivery: 'playlist_proxy',
        expiresAt: leaseTtl('nsrplay'),
      },
    ];
  }
}

function wrapPlaylistOrThrow(url: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return url;
  const params = new URLSearchParams({
    url,
    referer: 'https://nsrplay.space/',
  });
  const apiKey = process.env.CATALOG_API_KEY ?? '';
  if (apiKey) params.set('key', apiKey);
  return `${base}/api/v1/catalog/stream/playlist?${params.toString()}`;
}
