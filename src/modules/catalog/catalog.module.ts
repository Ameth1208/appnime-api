import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogController } from './catalog.controller';
import {
  CatalogService,
  METADATA_PROVIDER,
  MOVIE_PROVIDERS,
  SERIES_PROVIDERS,
} from './application/catalog.service';
import { TmdbService } from './infrastructure/tmdb/tmdb.service';
import { buildCatalogProviders, type AnyCatalogProvider } from './infrastructure/providers/provider-factory';
import { buildMetadataProvider } from './infrastructure/metadata/metadata.factory';
import { CatalogSearchService } from './infrastructure/search/catalog-search.service';
import { JkanimeSearchService } from './infrastructure/providers/jkanime/jkanime-search.service';
import { JkanimeCatalogService } from './infrastructure/providers/jkanime/jkanime-catalog.service';
import { JkAnimeAdapter } from './infrastructure/providers/jkanime/jkanime.adapter';

@Module({
  controllers: [CatalogController],
  providers: [
    TmdbService,
    CatalogSearchService,
    JkanimeSearchService,
    JkanimeCatalogService,
    {
      provide: MOVIE_PROVIDERS,
      inject: [ConfigService, JkanimeCatalogService],
      useFactory: (config: ConfigService, jk: JkanimeCatalogService): AnyCatalogProvider[] =>
        buildCatalogProviders(config, jk).filter((p) => p.supportedTypes.includes('movie')),
    },
    {
      provide: SERIES_PROVIDERS,
      inject: [ConfigService, JkanimeCatalogService],
      useFactory: (config: ConfigService, jk: JkanimeCatalogService): AnyCatalogProvider[] =>
        buildCatalogProviders(config, jk).filter((p) => p.supportedTypes.includes('series')),
    },
    {
      provide: METADATA_PROVIDER,
      inject: [ConfigService, TmdbService],
      useFactory: buildMetadataProvider,
    },
    CatalogService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}

