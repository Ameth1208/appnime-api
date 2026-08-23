import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from './application/catalog.service';
import { TmdbService } from './infrastructure/tmdb/tmdb.service';

@Controller('v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly tmdb: TmdbService,
    private readonly config: ConfigService,
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
    return res.results.map((r) => ({
      id: String(r.id),
      title: r.name ?? r.title ?? '',
      posterUrl: this.tmdb.imageUrl(r.poster_path),
      year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : undefined,
      rating: r.vote_average,
      type: 'Serie',
      url: `https://pelis24.online/serie/${r.id}`,
    }));
  }

  @Get('anime/popular')
  async animePopular(@Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const res = await this.tmdb.seriesAnime(p);
    return res.results.map((r) => ({
      id: String(r.id),
      title: r.name ?? r.title ?? '',
      posterUrl: this.tmdb.imageUrl(r.poster_path),
      year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : undefined,
      rating: r.vote_average,
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

  @Get('movies/:id/resolve')
  resolveMovie(@Param('id') id: string) {
    return this.catalog.resolveMovie(id);
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

  @Get('series/:id/seasons/:season/episodes/:episode/resolve')
  resolveEpisode(
    @Param('id') id: string,
    @Param('season') season: string,
    @Param('episode') episode: string,
  ) {
    return this.catalog.resolveEpisode(id, Number(season), Number(episode));
  }
}


