import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { curlFollow } from '../../http/flaresolverr.client';
import {
  StreamWishExtractor,
  FilemoonExtractor,
  DoodExtractor,
  GenericMediaExtractor,
} from '../../extractors';
import { JsUnpacker } from '../../extractors/js-unpacker';
import type { ResolvedStream, TmdbKeyedProvider } from '../../../domain/types';

const UNLIMPLAY = 'https://unlimplay.com';

function capitalizeLang(s: string): string {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
const NSRPLAY = 'https://nsrplay.space';

interface EmbedsData {
  [lang: string]: { [server: string]: string };
}

@Injectable()
export class UnlimplayCatalogProvider implements TmdbKeyedProvider {
  readonly supportsTmdbIds = true as const;
  readonly supportedTypes: ('movie' | 'series')[] = ['movie', 'series'];
  private readonly logger = new Logger(UnlimplayCatalogProvider.name);
  private readonly flareUrl: string;
  private readonly streamWish = new StreamWishExtractor();
  private readonly filemoon = new FilemoonExtractor();
  private readonly dood = new DoodExtractor();
  private readonly generic = new GenericMediaExtractor();

  constructor(config: ConfigService) {
    this.flareUrl = config.get<string>('FLARESOLVERR_URL') ?? '';
  }

  /// Cache de streams resueltos (10 min).
  private readonly resolved = new Map<string, { streams: ResolvedStream[]; at: number }>();

  get id(): string {
    return 'unlimplay';
  }

  get displayName(): string {
    return 'UnlimPlay Latino';
  }

  async resolveMovieByTmdb(id: number | string): Promise<ResolvedStream[]> {
    return this.withCache(`m:${id}`, () =>
      this.resolveFromEmbed(`${UNLIMPLAY}/f/embed/movie/${id}`),
    );
  }

  async resolveEpisodeByTmdb(
    id: number | string,
    season: number,
    episode: number,
  ): Promise<ResolvedStream[]> {
    return this.withCache(`t:${id}:${season}:${episode}`, () =>
      this.resolveFromEmbed(`${UNLIMPLAY}/f/embed/tv/${id}/${season}/${episode}`),
    );
  }

  private async withCache(
    key: string,
    fn: () => Promise<ResolvedStream[]>,
  ): Promise<ResolvedStream[]> {
    const cached = this.resolved.get(key);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.streams;
    const streams = await fn();
    if (streams.length > 0) this.resolved.set(key, { streams, at: Date.now() });
    return streams;
  }

  /// Descarga la página del embed de unlimplay y extrae los streams.
  ///
  /// La página contiene un objeto `EMBEDS` con estructura:
  /// ```json
  /// {
  ///   "latino":  { "direct": "m3u8", "streamwish": "...", ... },
  ///   "español": { "streamwish": "...", ... }
  /// }
  /// ```
  /// Prioriza latino > castellano > subtitulado, y dentro de cada idioma
  /// intenta el m3u8 directo + extractores conocidos.
  private async resolveFromEmbed(embedUrl: string): Promise<ResolvedStream[]> {
    const result = await curlFollow(embedUrl, UNLIMPLAY, 20000);
    const html = result.body;

    const m = html.match(/(?:const |var |let )?EMBEDS\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!m) throw new Error('unlimplay: EMBEDS not found');

    let data: EmbedsData;
    try {
      data = JSON.parse(m[1].replace(/\\\//g, '/')) as EmbedsData;
    } catch {
      throw new Error('unlimplay: invalid EMBEDS JSON');
    }

    this.logger.log(
      `unlimplay embed: idiomas=${Object.keys(data).join(', ')}`,
    );

    const langPriority = ['latino', 'español', 'castellano', 'subtitulado'];
    const serverPriority = ['direct', 'streamwish', 'filemoon', 'doodstream', 'vidhide', 'filelions'];

    // Construye candidatos ordenados: latino primero, direct/streamwish primero.
    type Candidate = { lang: string; server: string; url: string };
    const candidates: Candidate[] = [];
    const languages = Object.keys(data).sort(
      (a, b) =>
        (langPriority.indexOf(a.toLowerCase()) + 1 || 99) -
        (langPriority.indexOf(b.toLowerCase()) + 1 || 99),
    );

    for (const lang of languages) {
      const ordered = Object.keys(data[lang]).sort(
        (a, b) =>
          (serverPriority.indexOf(a) + 1 || 99) -
          (serverPriority.indexOf(b) + 1 || 99),
      );
      for (const server of ordered) {
        const url = data[lang][server];
        if (!url || !url.startsWith('http')) continue;
        candidates.push({ lang, server, url });
      }
    }

    if (candidates.length === 0) {
      throw new Error('unlimplay: no stream candidates');
    }

    // Resuelve en paralelo (máximo 8 para no saturar).
    const results = await Promise.allSettled(
      candidates.slice(0, 8).map(async (c): Promise<ResolvedStream[]> => {
        // "direct" ya es un m3u8 HLS — no necesita extractor.
        if (c.server === 'direct' && c.url.includes('.m3u8')) {
          return [
            {
              url: c.url.replace(/\\\//g, '/'),
              kind: 'hls',
              quality: 'auto',
              server: `${capitalizeLang(c.lang)} · directo`,
              providerId: this.id,
              headers: { referer: `${UNLIMPLAY}/` },
            },
          ];
        }

        // Otros servidores: sigue redirects y usa extractor apropiado.
        const source = await curlFollow(c.url, UNLIMPLAY, 15000);
        const hint = source.finalUrl + ' ' + source.body;

        // PRIORIDAD 1: Desempaquetar JS packed (Dean Edwards) que contiene el m3u8.
        const packedUrls = JsUnpacker.extractFromPacked(source.body);
        if (packedUrls.length > 0) {
          this.logger.log(`unlimplay ${capitalizeLang(c.lang)}/${c.server}: ${packedUrls.length} URLs from packed JS`);
          return packedUrls.map((u) => ({
            url: u,
            kind: (u.includes('.m3u8') ? 'hls' : 'mp4') as ResolvedStream['kind'],
            quality: 'auto' as const,
            server: `${capitalizeLang(c.lang)} · ${c.server}`,
            providerId: this.id,
          }));
        }

        // PRIORIDAD 2: m3u8 directo en el HTML sin unpacking.
        const directM3u8 = source.body.match(
          /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/,
        );
        if (directM3u8) {
          return [
            {
              url: directM3u8[0],
              kind: 'hls',
              quality: 'auto',
              server: `${capitalizeLang(c.lang)} · ${c.server}`,
              providerId: this.id,
              headers: { referer: new URL(source.finalUrl).origin },
            },
          ];
        }

        // PRIORIDAD 3: extractores conocidos.
        const extractor = this.extractorFor(hint);
        const resolved = await extractor.resolve(source.finalUrl, this.id);
        return resolved.map((s) => ({
          ...s,
          server: `${capitalizeLang(c.lang)} · ${c.server}`,
        }));
      }),
    );

    const streams = results.flatMap((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn(
          `[unlimplay] ${candidates[i]?.lang}/${candidates[i]?.server}: ${String(r.reason).substring(0, 100)}`,
        );
        return [];
      }
      return r.value;
    });

    // FALLBACK: si nada funcionó con curl, usa FlareSolverr (Chrome real)
    // para renderizar las páginas JS y extraer el m3u8 del contenido.
    if (streams.length === 0 && this.flareUrl) {
      this.logger.log('unlimplay: intentando via FlareSolverr...');
      const fsCandidates = candidates.filter((c) => !c.url.includes('netu')).slice(0, 4);
      for (const c of fsCandidates) {
        try {
          const res = await fetch(`${this.flareUrl}/v1`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cmd: 'request.get', url: c.url, maxTimeout: 60000 }),
            signal: AbortSignal.timeout(90000),
          });
          if (!res.ok) continue;
          const json = (await res.json()) as { solution?: { response?: string } };
          const html = json.solution?.response ?? '';
          if (!html) continue;
          const urls = JsUnpacker.extractFromPacked(html);
          const directMatch = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/);
          if (directMatch) urls.push(directMatch[0]);
          if (urls.length > 0) {
            this.logger.log(`unlimplay FS ${capitalizeLang(c.lang)}/${c.server}: ${urls.length} URLs`);
            return urls.map((u) => ({
              url: u,
              kind: (u.includes('.m3u8') ? 'hls' : 'mp4') as ResolvedStream['kind'],
              quality: 'auto',
              server: `${capitalizeLang(c.lang)} · ${c.server}`,
              providerId: this.id,
            }));
          }
        } catch {
          continue;
        }
      }
    }

    // Orden final: latino primero, HLS primero, calidad descendente.
    const langRank = (s: ResolvedStream) => {
      const label = (s.server ?? '').split(' ')[0].toLowerCase();
      return langPriority.indexOf(label) + 1 || 99;
    };
    streams.sort((a, b) => {
      const lr = langRank(a) - langRank(b);
      if (lr !== 0) return lr;
      const ha = a.kind === 'hls' ? 1 : 0;
      const hb = b.kind === 'hls' ? 1 : 0;
      if (ha !== hb) return hb - ha;
      return (Number(b.quality?.replace(/\D/g, '')) || 0) - (Number(a.quality?.replace(/\D/g, '')) || 0);
    });

    this.logger.log(`unlimplay resolved: ${streams.length} streams`);
    return streams;
  }

  private extractorFor(hint: string) {
    const lower = hint.toLowerCase();
    if (lower.includes('streamwish') || lower.includes('strwish') || lower.includes('hglink'))
      return this.streamWish;
    if (lower.includes('filemoon') || lower.includes('moonplayer')) return this.filemoon;
    if (this.dood.canHandle(lower)) return this.dood;
    return this.generic;
  }
}




