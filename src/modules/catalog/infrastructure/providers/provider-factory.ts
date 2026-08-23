import { ConfigService } from '@nestjs/config';
import { NsrPlayCatalogProvider } from './nsrplay/nsrplay.provider';
import { VidlinkCatalogProvider } from './vidlink/vidlink.provider';
import type { CatalogProviderMeta, TmdbKeyedProvider } from '../../domain/types';

export type AnyCatalogProvider = CatalogProviderMeta & Partial<TmdbKeyedProvider>;

export function buildCatalogProviders(config: ConfigService): AnyCatalogProvider[] {
  const providers: AnyCatalogProvider[] = [];

  // NSRPlay PRIMERO: español latino con HLS vía proxy propio.
  providers.push(new NsrPlayCatalogProvider());

  // Vidlink de respaldo: inglés + subtítulos.
  if ((config.get<string>('CATALOG_VIDLINK') ?? 'on').toLowerCase() !== 'off') {
    providers.push(new VidlinkCatalogProvider());
  }

  return providers;
}
