import { createHash } from 'node:crypto';
import { httpGetText } from '../http/fetcher';
import type { ResolvedStream } from '../../domain/types';

export interface StreamExtractor {
  readonly server: string;
  canHandle(url: string): boolean;
  resolve(url: string, providerId: string): Promise<ResolvedStream[]>;
}

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function hostOf(url: string): string {
  return new URL(url).host;
}

export class DoodExtractor implements StreamExtractor {
  readonly server = 'doodstream';

  private readonly hosts = ['dood.', 'ds2play', 'ds2video', 'd000d', 'dooood', 'dsvplay', 'vidpay', 'mixdrop'];

  canHandle(url: string): boolean {
    const lower = url.toLowerCase();
    return ['dood.', 'ds2play', 'ds2video', 'd000d', 'dooood'].some((h) => lower.includes(h));
  }

  async resolve(url: string, providerId: string): Promise<ResolvedStream[]> {
    try {
      const host = hostOf(url);
      const dlUrl = url.replace('/e/', '/download/');
      const html = await httpGetText(dlUrl, { headers: { referer: `https://${host}/` } });
      const md5Path =
        html.match(/\/pass_md5\/([a-f0-9]{32})/)?.[1] ??
        html.match(/md5\s*\(\s*'([^']+)'\s*\)/)?.[1] ??
        null;
      if (!md5Path) return [];
      const token = md5(md5Path);
      const streamUrl = `https://${host}/download/${md5Path}?token=${token}&expiry=${Date.now()}`;
      return [
        {
          url: streamUrl,
          kind: 'mp4',
          server: this.server,
          providerId,
          headers: { referer: `https://${host}/` },
        },
      ];
    } catch {
      return [];
    }
  }
}

export class StreamWishExtractor implements StreamExtractor {
  readonly server = 'streamwish';

  private readonly markers = [
    'streamwish',
    'strwish',
    'wishembed',
    'iplayerhls',
    'swdyu',
    'neko-stream',
    'streamgg',
    'kswplayer',
  ];

  canHandle(url: string): boolean {
    const lower = url.toLowerCase();
    return this.markers.some((m) => lower.includes(m));
  }

  async resolve(url: string, providerId: string): Promise<ResolvedStream[]> {
    try {
      const html = await httpGetText(url, {
        headers: { referer: new URL(url).origin + '/', accept: 'text/html' },
      });
      const streams: ResolvedStream[] = [];
      const m3u8s = new Set<string>();
      for (const match of html.matchAll(/["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/g)) {
        m3u8s.add(match[1]);
      }
      for (const match of html.matchAll(/file:\s*["']([^"']+)["']/g)) {
        if (match[1].includes('.m3u8') || match[1].startsWith('//')) {
          m3u8s.add(match[1].startsWith('//') ? `https:${match[1]}` : match[1]);
        }
      }
      for (const m3u8 of m3u8s) {
        const quality = m3u8.match(/\/(\d{3,4})\.m3u8/)?.[1];
        streams.push({
          url: m3u8,
          kind: 'hls',
          quality: quality ? `${quality}p` : 'auto',
          server: this.server,
          providerId,
          headers: { referer: new URL(url).origin + '/' },
        });
      }
      return streams;
    } catch {
      return [];
    }
  }
}

export class FilemoonExtractor implements StreamExtractor {
  readonly server = 'filemoon';

  canHandle(url: string): boolean {
    const lower = url.toLowerCase();
    return ['filemoon', 'moonplayer', 'files.im', 'moviesm4u'].some((h) => lower.includes(h));
  }

  async resolve(url: string, providerId: string): Promise<ResolvedStream[]> {
    try {
      const html = await httpGetText(url, { headers: { accept: 'text/html' } });
      const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/)?.[1];
      const target = iframe && iframe.startsWith('//') ? `https:${iframe}` : iframe ?? url;
      if (target !== url) return this.resolve(target, providerId);
      const streams: ResolvedStream[] = [];
      for (const match of html.matchAll(/["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/g)) {
        streams.push({
          url: match[1],
          kind: 'hls',
          quality: 'auto',
          server: this.server,
          providerId,
          headers: { referer: new URL(url).origin + '/' },
        });
      }
      return streams;
    } catch {
      return [];
    }
  }
}

export class EmbedPassthroughExtractor implements StreamExtractor {
  readonly server = 'embed';

  canHandle(): boolean {
    return true;
  }

  async resolve(url: string, providerId: string): Promise<ResolvedStream[]> {
    return [{ url, kind: 'embed', server: 'embed', providerId }];
  }
}

export class GenericMediaExtractor implements StreamExtractor {
  readonly server = 'generic';

  canHandle(): boolean {
    return true;
  }

  async resolve(url: string, providerId: string): Promise<ResolvedStream[]> {
    try {
      const html = await httpGetText(url, {
        headers: { accept: 'text/html,*/*', referer: new URL(url).origin + '/' },
      });
      const found = new Map<string, ResolvedStream>();
      for (const match of html.matchAll(/["'](https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)["']/g)) {
        const quality = match[1].match(/\/(\d{3,4})(?=\.m3u8)/)?.[1];
        found.set(match[1], {
          url: match[1],
          kind: 'hls',
          quality: quality ? `${quality}p` : 'auto',
          server: this.server,
          providerId,
          headers: { referer: new URL(url).origin + '/' },
        });
      }
      for (const match of html.matchAll(/["'](https?:\/\/[^"'\s]+?\.mp4[^"'\s]*)["']/g)) {
        found.set(match[1], { url: match[1], kind: 'mp4', server: this.server, providerId });
      }
      return [...found.values()];
    } catch {
      return [];
    }
  }
}

export function defaultExtractors(): StreamExtractor[] {
  return [
    new StreamWishExtractor(),
    new DoodExtractor(),
    new FilemoonExtractor(),
    new EmbedPassthroughExtractor(),
    new GenericMediaExtractor(),
  ];
}

export function extractWithFallback(
  embedUrls: { label: string; url: string }[],
  extractors: StreamExtractor[],
  providerId: string,
): Promise<ResolvedStream[]> {
  return (async () => {
    const results: ResolvedStream[] = [];
    for (const embed of embedUrls) {
      const extractor = extractors.find((e) => e.canHandle(embed.url));
      if (!extractor) continue;
      try {
        results.push(...(await extractor.resolve(embed.url, providerId)));
      } catch {
        continue;
      }
    }
    return results;
  })();
}
