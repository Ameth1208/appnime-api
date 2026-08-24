import { Injectable, Logger } from '@nestjs/common';
import { JkanimeCatalogService } from '../jkanime/jkanime-catalog.service';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import { leaseTtl, type ServerResolver } from './server-resolver';

/**
 * Resuelve anime vía jkanime. La fuente guarda el slug en providerItemId;
 * cada resolución scrapea la página del episodio para obtener la URL fresca
 * (descripción + iframes + servidores remotos base64 dentro del servicio).
 */
@Injectable()
export class JkAnimeSourceResolver implements ServerResolver {
  private readonly logger = new Logger(JkAnimeSourceResolver.name);

  constructor(private readonly jk: JkanimeCatalogService) {}

  supports(providerId: string): boolean {
    return providerId === 'jkanime';
  }

  async resolve(source: SourceCandidate): Promise<PlaybackLease[]> {
    const slug = source.providerItemId;
    if (!slug) throw new Error('jkanime source sin providerItemId (slug)');
    const episode = source.episodeNum > 0 ? source.episodeNum : 1;

    const url = await this.jk.resolveEpisode(slug, episode);
    if (!url) throw new Error('jkanime: sin stream para el episodio');

    const referer = `https://jkanime.net/${slug}/${episode}/`;
    this.logger.log(`jkanime resuelto: ${slug}#${episode} → ${new URL(url).host}`);
    return [
      {
        url,
        kind: url.includes('.m3u8') ? 'hls' : 'mp4',
        quality: source.quality ?? 'auto',
        headers: { referer },
        delivery: 'direct',
        expiresAt: leaseTtl(source.serverId),
      },
    ];
  }
}
