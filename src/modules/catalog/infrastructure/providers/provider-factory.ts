import { ConfigService } from '@nestjs/config';
import { NsrPlayCatalogProvider } from './nsrplay/nsrplay.provider';
import { VidlinkCatalogProvider } from './vidlink/vidlink.provider';
import { UnlimplayCatalogProvider } from './unlimplay/unlimplay.provider';
import { JkAnimeAdapter } from './jkanime/jkanime.adapter';
import { JkanimeCatalogService } from './jkanime/jkanime-catalog.service';
import type { CatalogProviderMeta, TmdbKeyedProvider } from '../../domain/types';

export type AnyCatalogProvider = CatalogProviderMeta & Partial<TmdbKeyedProvider>;

export function buildCatalogProviders(config: ConfigService, jkanimeService?: JkanimeCatalogService): AnyCatalogProvider[] {
  const providers: AnyCatalogProvider[] = [];

  // NSRPlay PRIMERO: español latino con HLS vía proxy propio.
  providers.push(new NsrPlayCatalogProvider());

  // UnlimPlay SEGUNDO: español latino, m3u8 directo + extractores.
  providers.push(new UnlimplayCatalogProvider());

  // JKAnime CUARTO: anime en español/latino (scrape server-side).
  if (jkanimeService) {
    providers.push(new JkAnimeAdapter(jkanimeService));
  }

  // Vidlink ÚLTIMO: inglés con subtítulos multi-idioma (fallback universal).
  if ((config.get<string>('CATALOG_VIDLINK') ?? 'on').toLowerCase() !== 'off') {
    providers.push(new VidlinkCatalogProvider());
  }

  return providers;
}
