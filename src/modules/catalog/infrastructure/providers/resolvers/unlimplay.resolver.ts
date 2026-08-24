import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StreamWishExtractor,
  FilemoonExtractor,
  DoodExtractor,
  GenericMediaExtractor,
} from '../../extractors';
import { JsUnpacker } from '../../extractors/js-unpacker';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import { leaseTtl, type ServerResolver } from './server-resolver';
import { needsTunnel, tunnelIfLocked } from '../../http/tunnel.util';

const UNLIMPLAY = 'https://unlimplay.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Resuelve fuentes de UnlimPlay a partir de la URL del embed guardada en
 * `StreamSource.providerUrl`. Extrae el m3u8 fresco en cada resolución.
 *
 * Tier 1: HTTP directo + packed JS / m3u8 en HTML (2-5s).
 * Tier 2: extractor específico por servidor (3-5s).
 * Tier 3: FlareSolverr (10-15s, último recurso).
 */
@Injectable()
export class UnlimplaySourceResolver implements ServerResolver {
  private readonly logger = new Logger(UnlimplaySourceResolver.name);
  private readonly flareUrl: string;
  private readonly streamWish = new StreamWishExtractor();
  private readonly filemoon = new FilemoonExtractor();
  private readonly dood = new DoodExtractor();
  private readonly generic = new GenericMediaExtractor();

  constructor(config: ConfigService) {
    this.flareUrl = config.get<string>('FLARESOLVERR_URL') ?? '';
  }

  supports(providerId: string): boolean {
    return providerId === 'unlimplay';
  }

  async resolve(source: SourceCandidate): Promise<PlaybackLease[]> {
    const embedUrl = source.providerUrl;
    if (!embedUrl) throw new Error('unlimplay source sin providerUrl');

    // Tier 1 + 2
    const leases = await this.resolveHttp(embedUrl, source);
    if (leases.length > 0) return leases;

    // Tier 3: FlareSolverr solo como último recurso.
    if (this.flareUrl) {
      const fsLeases = await this.resolveViaFlareSolverr(embedUrl, source);
      if (fsLeases.length > 0) return fsLeases;
    }

    throw new Error(`unlimplay/${source.serverId}: sin streams tras extracción escalonada`);
  }

  private async resolveHttp(url: string, source: SourceCandidate): Promise<PlaybackLease[]> {
    let html: string;
    let finalUrl = url;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, referer: `${UNLIMPLAY}/`, accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`unlimplay embed HTTP ${res.status}`);
      finalUrl = res.url || url;
      html = await res.text();
    } catch (err) {
      this.logger.warn(`tier1 fetch falló (${source.serverId}): ${String(err).slice(0, 80)}`);
      return [];
    }

    const found: PlaybackLease[] = [];

    // Packed JS (Dean Edwards) que contiene el m3u8.
    for (const u of JsUnpacker.extractFromPacked(html)) {
      found.push(this.toLease(u, source));
    }
    // m3u8 directos en el HTML.
    for (const m of html.matchAll(/["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/g)) {
      found.push(this.toLease(m[1], source));
    }
    // file:"..." con m3u8 relativo //.
    for (const m of html.matchAll(/file:\s*["']([^"']+)["']/g)) {
      if (m[1].includes('.m3u8')) {
        found.push(this.toLease(m[1].startsWith('//') ? `https:${m[1]}` : m[1], source));
      }
    }
    if (found.length > 0) return dedupe(found);

    // Tier 2: extractor específico según el host final.
    const hint = `${finalUrl} ${html}`.toLowerCase();
    const extractor = hint.includes('streamwish') || hint.includes('hglink')
      ? this.streamWish
      : hint.includes('filemoon') || hint.includes('moonplayer')
        ? this.filemoon
        : this.dood.canHandle(hint)
          ? this.dood
          : this.generic;
    try {
      const resolved = await extractor.resolve(finalUrl, source.providerId);
      for (const s of resolved) {
        if (s.kind !== 'hls' && s.kind !== 'mp4') continue;
        found.push({
          url: tunnelIfLocked(s.url, s.headers?.referer ?? `${UNLIMPLAY}/`),
          kind: s.kind,
          headers: needsTunnel(s.url) ? undefined : s.headers,
          quality: s.quality ?? 'auto',
          delivery: needsTunnel(s.url) ? 'tunnel' : 'direct',
          expiresAt: leaseTtl(source.serverId),
        });
      }
    } catch (err) {
      this.logger.warn(`tier2 extractor falló (${source.serverId}): ${String(err).slice(0, 80)}`);
    }
    return dedupe(found);
  }

  private async resolveViaFlareSolverr(url: string, source: SourceCandidate): Promise<PlaybackLease[]> {
    try {
      const res = await fetch(`${this.flareUrl}/v1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { solution?: { response?: string } };
      const html = json.solution?.response ?? '';
      if (!html) return [];
      const urls = JsUnpacker.extractFromPacked(html);
      const direct = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/);
      if (direct) urls.push(direct[0]);
      return dedupe(urls.map((u) => this.toLease(u, source)));
    } catch (err) {
      this.logger.warn(`FlareSolverr falló (${source.serverId}): ${String(err).slice(0, 100)}`);
      return [];
    }
  }

  private toLease(rawUrl: string, _source: SourceCandidate): PlaybackLease {
    const kind: 'hls' | 'mp4' = rawUrl.includes('.m3u8') ? 'hls' : 'mp4';
    const locked = needsTunnel(rawUrl);
    return {
      url: locked ? (tunnelIfLocked(rawUrl, `${UNLIMPLAY}/`)) : rawUrl,
      kind,
      quality: rawUrl.match(/\/(\d{3,4})\.m3u8/)?.[1]
        ? `${rawUrl.match(/\/(\d{3,4})\.m3u8/)![1]}p`
        : 'auto',
      delivery: locked ? 'tunnel' : 'direct',
      expiresAt: leaseTtl(_source.serverId),
    };
  }
}

function dedupe(leases: PlaybackLease[]): PlaybackLease[] {
  const seen = new Set<string>();
  return leases.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}
