import { Injectable } from '@nestjs/common';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import { leaseTtl, type ServerResolver } from './server-resolver';

const NSRPLAY = 'https://nsrplay.space';
const UA = { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'application/json' };

/// Hosts de test/fake que nsrplay devuelve cuando no tiene el contenido real.
const NSRPLAY_BLOCKED = [
  'test-videos.co.uk',
  'test-streams.mux.dev',
  'sample-videos.com',
  'commondatastorage.googleapis.com',
  'file-examples.com',
  'sample-videos.com',
  'www.w3schools.com',
  'jplayer.org',
  'html5rocks.com',
  'devimages.apple.com',
];

function isBlocked(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return NSRPLAY_BLOCKED.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

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
    if (isBlocked(rj.data.playUrl)) throw new Error(`nsrplay stream fake/bloqueado: ${new URL(rj.data.playUrl).hostname}`);

    // Validación anti-fantasma: nsrplay a veces responde 200 con una imagen
    // PNG (anti-hotlink) en vez del stream. Verificamos que el playlist que
    // sirve nuestro proxy tenga segmentos con contenido de video real.
    const proxied = wrapPlaylistOrThrow(rj.data.playUrl);
    const check = await fetch(proxied, { signal: AbortSignal.timeout(15000) });
    if (!check.ok) throw new Error(`nsrplay playlist HTTP ${check.status}`);
    const playlistText = await check.text();
    const firstSegment = playlistText
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('http'));
    if (!firstSegment) throw new Error('nsrplay playlist sin segmentos');
    try {
      const segHead = await fetch(firstSegment, {
        method: 'GET',
        headers: UA,
        signal: AbortSignal.timeout(12000),
      });
      const contentType = segHead.headers.get('content-type') ?? '';
      if (/^image\//i.test(contentType)) {
        throw new Error(`nsrplay sirviendo ${contentType} (stream fantasma)`);
      }
    } catch (err) {
      throw new Error(
        `nsrplay validación falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return [
      {
        // nsrplay siempre vía playlist-proxy propio (su CDN requiere referer).
        url: proxied,
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
