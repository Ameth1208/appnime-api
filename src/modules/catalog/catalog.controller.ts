import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from './application/catalog.service';
import { UnavailableCatalogService } from './application/catalog-unavailable.service';
import { TmdbService } from './infrastructure/tmdb/tmdb.service';
import { PlaybackService, type ResolveRequest } from './application/playback.service';
import type { ResolvedLease } from './application/playback.service';

@Controller('v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly tmdb: TmdbService,
    private readonly playback: PlaybackService,
    private readonly config: ConfigService,
    private readonly unavailable: UnavailableCatalogService,
  ) {}

  private checkUnlock(unlock?: string): void {
    const secret = this.config.get<string>('ADULT_SECRET_CODE') ?? '';
    if (secret && unlock === secret) this.tmdb.adultMode = true;
  }

  @Get('providers')
  providers() {
    return this.catalog.listProviders();
  }

  // ── Anime ────────────────────────────────────────────────────────────────

  @Get('anime/search')
  async animeSearch(@Query('q') q = '', @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const res = await this.tmdb.seriesAnimeSearch(q, p);
    const items = await this.unavailable.filterAvailable(
      res.results.map((r) => ({
        id: String(r.id),
        type: 'anime' as const,
        title: r.name ?? r.title ?? '',
        posterUrl: this.tmdb.imageUrl(r.poster_path),
        year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : undefined,
        rating: r.vote_average,
      })),
    );
    return items.map((r) => ({
      id: r.id,
      title: r.title,
      posterUrl: r.posterUrl,
      year: r.year,
      rating: r.rating,
      type: 'Serie',
      url: `https://pelis24.online/serie/${r.id}`,
    }));
  }

  @Get('anime/popular')
  async animePopular(@Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const res = await this.tmdb.seriesAnime(p);
    const items = await this.unavailable.filterAvailable(
      res.results.map((r) => ({
        id: String(r.id),
        type: 'anime' as const,
        title: r.name ?? r.title ?? '',
        posterUrl: this.tmdb.imageUrl(r.poster_path),
        year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : undefined,
        rating: r.vote_average,
      })),
    );
    return items.map((r) => ({
      id: r.id,
      title: r.title,
      posterUrl: r.posterUrl,
      year: r.year,
      rating: r.rating,
      type: 'Serie',
      url: `https://pelis24.online/serie/${r.id}`,
    }));
  }

  // ── Películas ──────────────────────────────────────────────────────────────

  @Get('movies/popular')
  moviesPopular(@Query('page') page = '1') {
    return this.catalog.moviesPopular({ page: Math.max(1, Number(page) || 1) });
  }

  @Get('movies/search')
  moviesSearch(@Query('q') q = '', @Query('page') page = '1', @Query('unlock') unlock = '') {
    this.checkUnlock(unlock);
    return this.catalog.searchMovies(q, Math.max(1, Number(page) || 1));
  }

  @Get('movies/:id')
  movie(@Param('id') id: string) {
    return this.catalog.getMovie(id);
  }

  // ── Series ────────────────────────────────────────────────────────────────

  @Get('series/popular')
  seriesPopular(@Query('page') page = '1') {
    return this.catalog.seriesPopular({ page: Math.max(1, Number(page) || 1) });
  }

  @Get('series/search')
  seriesSearch(@Query('q') q = '', @Query('page') page = '1', @Query('unlock') unlock = '') {
    this.checkUnlock(unlock);
    return this.catalog.searchSeries(q, Math.max(1, Number(page) || 1));
  }

  @Get('series/:id')
  series(@Param('id') id: string) {
    return this.catalog.getSeries(id);
  }

  @Get('series/:id/seasons/:season')
  seasonEpisodes(@Param('id') id: string, @Param('season') season: string) {
    return this.catalog.getSeasonEpisodes(id, Number(season));
  }

  // ── Resolución de streams (v2: registry + discovery bajo demanda) ────────

  /// Formato legacy-compatible (array plano) con campos estructurados
  /// aditivos para clientes nuevos. No rompe la app actual.
  private static toLegacyResponse(leases: ResolvedLease[]) {
    return leases.map((l) => ({
      // ── Contrato legacy ──
      url: l.url,
      kind: l.kind,
      quality: l.quality,
      server: `${l.languageName} · ${l.server}`,
      providerId: l.provider,
      ...(l.headers ? { headers: l.headers } : {}),
      // ── Campos estructurados v2 ──
      leaseId: l.leaseId,
      language: { code: l.languageCode, name: l.languageName },
      source: { provider: l.provider, server: l.server },
      delivery: l.delivery,
      expiresAt: l.expiresAt?.toISOString(),
      ...(l.subtitles?.length ? { subtitles: l.subtitles } : {}),
    }));
  }

  @Get('series/:id/seasons/:season/episodes/:episode/resolve')
  async resolveEpisode(
    @Param('id') id: string,
    @Param('season') season: string,
    @Param('episode') episode: string,
    @Query('lang') lang = 'es-419',
  ) {
    if (await this.unavailable.isBlocked(String(id), 'series')) {
      throw new NotFoundException({ code: 'CONTENT_UNAVAILABLE' });
    }
    const req: ResolveRequest = {
      tmdbId: id,
      contentType: 'series',
      season: Number(season),
      episode: Number(episode),
      languageCode: lang || undefined,
    };
    const leases = await this.playback.resolve(req);
    if (leases.length === 0) {
      throw new NotFoundException({
        code: 'NO_STREAMS_FOUND',
        triedProviders: this.playback.knownProviders,
      });
    }
    return CatalogController.toLegacyResponse(leases);
  }

  @Get('movies/:id/resolve')
  async resolveMovie(@Param('id') id: string, @Query('lang') lang = 'es-419') {
    if (await this.unavailable.isBlocked(String(id), 'movie')) {
      throw new NotFoundException({ code: 'CONTENT_UNAVAILABLE' });
    }
    const req: ResolveRequest = { tmdbId: id, contentType: 'movie', languageCode: lang || undefined };
    const leases = await this.playback.resolve(req);
    if (leases.length === 0) {
      throw new NotFoundException({
        code: 'NO_STREAMS_FOUND',
        triedProviders: this.playback.knownProviders,
      });
    }
    return CatalogController.toLegacyResponse(leases);
  }

  /// Discovery anticipado SIN generar URLs/token (llamado por preload de la app).
  @Get(['series/:id/seasons/:season/episodes/:episode/prepare', 'movies/:id/prepare'])
  async prepare(
    @Param('id') id: string,
    @Param('season') season = '0',
    @Param('episode') episode = '0',
  ): Promise<{ discovered: number }> {
    const isSeries = episode !== '0' && episode !== '';
    return this.playback.prepare({
      tmdbId: id,
      contentType: isSeries ? 'series' : 'movie',
      season: isSeries ? Number(season) : undefined,
      episode: isSeries ? Number(episode) : undefined,
    });
  }

  /// Feedback real de reproducción desde PlayerSession.
  @Post('playback/:leaseId/success')
  playbackSuccess(@Param('leaseId') leaseId: string) {
    return { ok: this.playback.reportSuccess(leaseId) };
  }

  @Post('playback/:leaseId/failure')
  playbackFailure(@Param('leaseId') leaseId: string, @Query('reason') reason?: string) {
    return { ok: this.playback.reportFailure(leaseId, reason) };
  }
}


