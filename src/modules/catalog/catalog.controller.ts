import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './application/catalog.service';
import { JkanimeSearchService } from './infrastructure/providers/jkanime/jkanime-search.service';

@Controller('v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly jkanime: JkanimeSearchService,
  ) {}

  @Get('anime/search')
  animeSearch(@Query('q') q = '', @Query('page') page = '1') {
    return this.jkanime.search(q, Math.max(1, Number(page) || 1));
  }

  @Get('anime/popular')
  animePopular(@Query('page') page = '1') {
    return this.jkanime.popular(Math.max(1, Number(page) || 1));
  }

  @Get('providers')
  providers() {
    return this.catalog.listProviders();
  }

  @Get('movies/popular')
  moviesPopular(@Query('page') page = '1') {
    return this.catalog.moviesPopular({ page: Math.max(1, Number(page) || 1) });
  }

  @Get('movies/search')
  moviesSearch(@Query('q') q = '', @Query('page') page = '1') {
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

  @Get('series/popular')
  seriesPopular(@Query('page') page = '1') {
    return this.catalog.seriesPopular({ page: Math.max(1, Number(page) || 1) });
  }

  @Get('series/search')
  seriesSearch(@Query('q') q = '', @Query('page') page = '1') {
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
  resolveEpisode(@Param('id') id: string, @Param('season') season: string, @Param('episode') episode: string) {
    return this.catalog.resolveEpisode(id, Number(season), Number(episode));
  }
}
