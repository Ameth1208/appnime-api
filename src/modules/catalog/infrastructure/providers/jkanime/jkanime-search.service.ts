import * as cheerio from 'cheerio';
import { Injectable, Logger } from '@nestjs/common';
import { TtlCache, httpGetText } from '../../http/fetcher';
export interface AnimeSummary {
  id: string;
  title: string;
  imageUrl?: string;
}

const BASE = 'https://jkanime.net';
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

@Injectable()
export class JkanimeSearchService {
  private readonly logger = new Logger(JkanimeSearchService.name);
  private readonly cache = new TtlCache<AnimeSummary[]>(5 * 60 * 1000);

  async search(query: string, page = 1): Promise<AnimeSummary[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    // Un scrape fallido devuelve [] y NO se cachea (evita envenenar 5 min).
    const cached = this.cache.get(`s:${normalized}:${page}`);
    if (cached && cached.length > 0) return cached;
    const fresh = await this.scrape(`/buscar/${normalized.replace(/\s+/g, '_')}/`);
    if (fresh.length > 0) this.cache.set(`s:${normalized}:${page}`, fresh);
    return fresh;
  }

  async popular(page = 1): Promise<AnimeSummary[]> {
    const key = `p:${page}`;
    const cached = this.cache.get(key);
    if (cached && cached.length > 0) return cached;
    const fresh = await this.scrape(page > 1 ? `/directorio/?p=${page}` : '/');
    if (fresh.length > 0) this.cache.set(key, fresh);
    return fresh;
  }

  private async scrape(path: string): Promise<AnimeSummary[]> {
    try {
      const html = await httpGetText(`${BASE}${path}`, { headers: UA, timeoutMs: 20000 });
      const $ = cheerio.load(html);
      const seen = new Set<string>();
      const items: AnimeSummary[] = [];

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
        const imageUrl =
          img.attr('data-setbg') ?? img.attr('data-src') ?? img.attr('src') ?? undefined;

        let id: string;
        try {
          const resolved = new URL(href, BASE);
          const segments = resolved.pathname.split('/').filter(Boolean);
          id = segments.length > 0 ? segments[segments.length - 1] : resolved.pathname;
        } catch {
          continue;
        }
        if (!id || id === '') continue;
        items.push({ id, title, imageUrl });
      }
      return items;
    } catch (err) {
      this.logger.warn(`jkanime scrape fallo (${path}): ${String(err)}`);
      return [];
    }
  }
}
