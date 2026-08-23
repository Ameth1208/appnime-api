import { ConfigService } from '@nestjs/config';
import { MultiApiCatalogProvider } from './multiapi/multiapi.provider';
import { VidlinkCatalogProvider } from './vidlink/vidlink.provider';
import type { CatalogProviderMeta, TmdbKeyedProvider } from '../../domain/types';

export type AnyCatalogProvider = CatalogProviderMeta & Partial<TmdbKeyedProvider>;

export function buildCatalogProviders(config: ConfigService): AnyCatalogProvider[] {
  const providers: AnyCatalogProvider[] = [];
  if ((config.get<string>('CATALOG_VIDLINK') ?? 'on').toLowerCase() !== 'off') {
    providers.push(new VidlinkCatalogProvider());
  }
  providers.push(new MultiApiCatalogProvider(config.get<string>('CATALOG_EMBED_SOURCES')));
  return providers;
}
