import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Meilisearch, type Index } from 'meilisearch';
import { TmdbService } from '../tmdb/tmdb.service';

export interface CatalogSearchDocument {
  id: string;
  type: 'movie' | 'series';
  title: string;
  posterUrl?: string;
  year?: number;
  rating?: number;
}

const INDEX = 'catalog';
const SYNC_PAGES = 40;

@Injectable()
export class CatalogSearchService {
  private readonly logger = new Logger(CatalogSearchService.name);
  private client?: Meilisearch;
  private index?: Index;
  private syncing?: Promise<void>;
  private lastSyncAt = 0;
  private lastWarnAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly tmdb: TmdbService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.get<string>('MEILI_HOST'));
  }

  private async getIndex(): Promise<Index> {
    if (this.index) return this.index;
    const host = this.config.get<string>('MEILI_HOST')!;
    const apiKey = this.config.get<string>('MEILI_MASTER_KEY') ?? undefined;
    const client = new Meilisearch({ host, apiKey });
    this.client = client;

    // Garantiza que el índice exista CON primaryKey 'id'. Si existe con otra
    // pk (estado corrupto), se elimina y recrea: los docs viejos son
    // regenerados por el sync.
    const info = await client.getIndex(INDEX).catch(() => null);
    if (info && info.primaryKey !== 'id') {
      await client.deleteIndex(INDEX);
      await client.createIndex(INDEX, { primaryKey: 'id' }).waitTask();
    } else if (!info) {
      await client.createIndex(INDEX, { primaryKey: 'id' }).waitTask();
    }
    await client
      .index(INDEX)
      .updateSettings({
        searchableAttributes: ['title'],
        filterableAttributes: ['type', 'year'],
        sortableAttributes: ['rating', 'popularity', 'year'],
      })
      .waitTask();

    this.index = client.index(INDEX);
    return this.index;
  }

  /// Dispara la sincronización del catálogo TMDB hacia Meilisearch EN SEGUNDO
  /// PLANO (una vez cada 6 horas). Nunca bloquea las búsquedas: mientras el
  /// índice se llena, las búsquedas caen al fallback difuso sobre TMDB.
  async ensureSynced(): Promise<void> {
    if (!this.enabled) return;
    if (this.syncing || Date.now() - this.lastSyncAt < 6 * 60 * 60 * 1000) {
      return;
    }
    this.lastSyncAt = Date.now();
    this.syncing = this.sync()
      .then(() => this.logger.log('Meilisearch sync completo'))
      .catch((err) => this.logger.warn(`meilisearch sync fallo: ${String(err)}`))
      .finally(() => {
        this.syncing = undefined;
      });
  }

  private async sync(): Promise<void> {
    const index = await this.getIndex();
    let docs = 0;
    for (let page = 1; page <= SYNC_PAGES; page++) {
      for (const type of ['movie', 'series'] as const) {
        const res =
          type === 'movie'
            ? await this.tmdb.moviesPopular(page)
            : await this.tmdb.seriesPopular(page);
        const documents = res.results.map((r) => ({
          id: `${type}:${r.id}`,
          type,
          title: r.title ?? r.name ?? '',
          posterUrl: this.tmdb.imageUrl(r.poster_path),
          year: r.release_date ? Number(r.release_date.slice(0, 4)) : r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : undefined,
          rating: r.vote_average,
          popularity: r.popularity,
        }));
        if (documents.length > 0) {
          await index.addDocuments(documents).waitTask();
          docs += documents.length;
        }
      }
    }
    this.logger.log(`Meilisearch sync completo: ${docs} documentos`);
  }

  async search(query: string, kind: 'movie' | 'series', limit = 30): Promise<CatalogSearchDocument[]> {
    if (!this.enabled) return [];
    try {
      await this.ensureSynced();
      const index = await this.getIndex();
      const res = await index.search<CatalogSearchDocument>(query, {
        limit,
        filter: [`type = ${kind}`],
        sort: ['popularity:desc'],
      });
      return res.hits;
    } catch (err) {
      // Meilisearch puede estar caído o sin sincronizar: no es fatal porque la
      // búsqueda cae al fallback difuso sobre TMDB (catalog.service). Evitamos
      // loguear en cada request (espamea la consola).
      const now = Date.now();
      if (now - this.lastWarnAt > 10 * 60 * 1000) {
        this.lastWarnAt = now;
        this.logger.warn(`meilisearch search fallo: ${String(err)}`);
      }
      return [];
    }
  }
}


