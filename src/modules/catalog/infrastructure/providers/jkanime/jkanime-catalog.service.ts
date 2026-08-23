import * as cheerio from 'cheerio';
import { Injectable } from '@nestjs/common';
import { TtlCache, httpGetText } from '../../http/fetcher';

const BASE = 'https://jkanime.net';
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

export interface AnimeDetails {
  slug: string;
  title: string;
  description: string;
  imageUrl?: string;
  episodeCount: number;
  csrfToken?: string;
  episodeEndpoint?: string;
}

export interface JkEpisode {
  number: number;
  url: string;
  title?: string;
  image?: string;
}

@Injectable()
export class JkanimeCatalogService {
  private readonly cache = new TtlCache<unknown>(5 * 60 * 1000);

  async search(query: string): Promise<{ id: string; title: string; imageUrl?: string }[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const key = `s:${normalized}`;
    const cached = this.cache.get(key);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached as { id: string; title: string; imageUrl?: string }[];
    const fresh = await this.scrapeSearch(`/buscar/${normalized.replace(/\s+/g, '_')}/`);
    if (fresh.length > 0) this.cache.set(key, fresh);
    return fresh;
  }

  async popular(): Promise<{ id: string; title: string; imageUrl?: string }[]> {
    const key = 'popular';
    const cached = this.cache.get(key);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached as { id: string; title: string; imageUrl?: string }[];
    const fresh = await this.scrapeSearch('/');
    if (fresh.length > 0) this.cache.set(key, fresh);
    return fresh;
  }

  private async scrapeSearch(path: string): Promise<{ id: string; title: string; imageUrl?: string }[]> {
    try {
      const html = await httpGetText(`${BASE}${path}`, { headers: UA, timeoutMs: 20000 });
      const $ = cheerio.load(html);
      const seen = new Set<string>();
      const items: { id: string; title: string; imageUrl?: string }[] = [];
      const cards = $('.anime__item, .card, .dir1, div.col-lg-4, div.col-md-6, div.col-6');
      const elements = cards.length > 0 ? cards.toArray() : $('h5 a').toArray();
      for (const el of elements) {
        const element = $(el);
        const anchor = el.tagName === 'a' ? element : element.find('a').first();
        const href = anchor.attr('href');
        if (!href || href === '#') continue;
        if (/\/(buscar|genero|tipo|directorio)\//.test(href)) continue;
        const titleEl = element.find('h5, h6, .card-title').first();
        const title = (titleEl.text() || anchor.text()).trim();
        if (title.length < 2 || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        const img = element.find('[data-setbg], img.card-img-top, img').first();
        const imageUrl = img.attr('data-setbg') ?? img.attr('data-src') ?? img.attr('src') ?? undefined;
        let id: string;
        try {
          const resolved = new URL(href, BASE);
          const segments = resolved.pathname.split('/').filter(Boolean);
          id = segments[segments.length - 1] ?? '';
        } catch { continue; }
        if (!id) continue;
        items.push({ id, title, imageUrl });
      }
      return items;
    } catch { return []; }
  }

  // ── Detalles ─────────────────────────────────────────────────────────────

  async details(slug: string): Promise<AnimeDetails> {
    const html = await httpGetText(`${BASE}/${slug}/`, { headers: UA, timeoutMs: 20000 });
    const $ = cheerio.load(html);
    const imageValue = $('meta[property="og:image"]').attr('content') ?? undefined;
    const description =
      $('.anime__details__text p').text().trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() || '';
    const pageText = $.text() ?? '';
    const typeMatch = pageText.match(/Tipo:\s*([^\n\r]+)/i);
    const countMatch = pageText.match(/Episodios:\s*(\d+)/i);
    const tokenMatch = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)['"]/i);
    const endpointMatch = html.match(/url:\s*['"](https:\/\/jkanime\.net\/ajax\/episodes\/\d+\/?)['"]/i);

    return {
      slug,
      title: $('h1').first().text().trim() || $('title').first().text().split('|')[0].trim(),
      description,
      imageUrl: imageValue ?? undefined,
      episodeCount: Number(countMatch?.[1]) || 0,
      csrfToken: tokenMatch?.[1],
      episodeEndpoint: endpointMatch?.[1],
    };
  }

  async episodes(slug: string): Promise<JkEpisode[]> {
    const details = await this.details(slug);
    let episodeCount = details.episodeCount;
    const episodes: JkEpisode[] = [];

    if (details.csrfToken && details.episodeEndpoint) {
      try {
        const res = await fetch(details.episodeEndpoint, {
          method: 'POST',
          headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded', referer: `${BASE}/${slug}/` },
          body: new URLSearchParams({ _token: details.csrfToken }).toString(),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const json = (await res.json()) as { total?: number; data?: { number: number; title?: string; image?: string }[] };
          if (json.total) episodeCount = json.total;
          for (const item of json.data ?? []) {
            episodes.push({
              number: item.number,
              url: `${BASE}/${slug}/${item.number}/`,
              title: item.title ?? undefined,
              image: item.image ?? undefined,
            });
          }
        }
      } catch { /* fallback a conteo visible */ }
    }

    if (episodes.length === 0 && episodeCount > 0) {
      for (let i = 1; i <= episodeCount; i++) {
        episodes.push({ number: i, url: `${BASE}/${slug}/${i}/` });
      }
    }
    return episodes;
  }

  // ── Resolución de streams ───────────────────────────────────────────────

  async resolveEpisode(slug: string, episodeNumber: number): Promise<string | null> {
    const pageUrl = `${BASE}/${slug}/${episodeNumber}/`;
    const pageHtml = await httpGetText(pageUrl, { headers: UA, timeoutMs: 15000 });

    // 1) Video directo en la página
    const direct = this.extractVideoUrl(pageHtml, pageUrl);
    if (direct && this.looksLikeMedia(direct)) return direct;

    // 2) Iframes embebidos
    for (const iframeUri of this.extractIframeUrls(pageHtml, pageUrl)) {
      try {
        const iframeHtml = await httpGetText(iframeUri.toString(), {
          headers: { ...UA, referer: pageUrl }, timeoutMs: 8000,
        });
        const found = this.extractVideoUrl(iframeHtml, iframeUri.toString());
        if (found && this.looksLikeMedia(found)) return found;
      } catch { continue; }
    }

    // 3) Servidores remotos (base64)
    for (const remoteUri of this.extractRemoteServers(pageHtml)) {
      try {
        const remoteHtml = await httpGetText(remoteUri, {
          headers: { ...UA, referer: pageUrl }, timeoutMs: 8000,
        });
        const video = this.extractVideoUrl(remoteHtml, remoteUri);
        if (video && this.looksLikeMedia(video)) return video;
        const download = this.extractDownloadUrl(remoteHtml);
        if (download && this.looksLikeMedia(download)) return download;
      } catch { continue; }
    }
    return null;
  }

  private extractVideoUrl(source: string, base: string): string | null {
    const patterns = [
      /video\s*:\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]/gis,
      /<source[^>]+src=["']([^"']+)["']/gi,
    ];
    let fallback: string | null = null;
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const value = match[1];
        if (!value || value.startsWith('blob:')) continue;
        try {
          const candidate = new URL(value.replace(/\\\//g, '/'), base).toString();
          if (!candidate.startsWith('http')) continue;
          if (this.looksLikeMedia(candidate)) return candidate;
          fallback ??= candidate;
        } catch { continue; }
      }
    }
    return fallback;
  }

  private extractIframeUrls(source: string, baseUrl: string): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const m of source.matchAll(/<iframe[^>]+src=(?:"([^"]+)"|'([^']+)')/gi)) {
      const value = (m[1] ?? m[2])!;
      if (!value || value.includes("'") || !seen.add(value)) continue;
      try { urls.push(new URL(value, baseUrl).toString()); } catch { continue; }
    }
    return urls;
  }

  private extractRemoteServers(source: string): string[] {
    const match = source.match(/var\s+servers\s*=\s*(\[.*?\]);/s);
    if (!match) return [];
    try {
      const servers = JSON.parse(match[1]) as { remote?: string }[];
      return servers
        .map((item) => item.remote)
        .filter((r): r is string => Boolean(r))
        .map((r) => Buffer.from(r, 'base64').toString('utf-8').trim())
        .filter((r) => r.startsWith('http'));
    } catch { return []; }
  }

  private extractDownloadUrl(source: string): string | null {
    return source.match(/href=["'](https:\/\/download[^"']+)['"]/)?.[1] ?? null;
  }

  private looksLikeMedia(url: string): boolean {
    return /\.(m3u8|mp4|mkv|webm|ts|mov|m4v|avi|ogv)(\?|#|\/|$)/i.test(url);
  }
}

