import { ConfigService } from '@nestjs/config';
import { TmdbService } from '../tmdb/tmdb.service';
import { TmdbMetadataAdapter } from './tmdb-metadata.adapter';
import { CinemetaService } from './cinemeta.service';
import type { MetadataProvider } from '../../domain/metadata-provider.interface';

export function buildMetadataProvider(config: ConfigService, tmdb: TmdbService): MetadataProvider {
  if (config.get<string>('TMDB_API_KEY')) return new TmdbMetadataAdapter(tmdb);
  return new CinemetaService();
}
