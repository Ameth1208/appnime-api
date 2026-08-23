import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

const ALLOWED_HOSTS = [
  'nsrplay.space',
  'unlimplay.com',
  'medixiru.com',
  'vimeos.net',
  'hglink.to',
  'streamwish.to',
  'doodstream.com',
  'playmogo.com',
  'voe.sx',
  'minochinos.com',
  'streamtape.com',
  'bcdn.hakunaymatata.com',
  'cacdn.hakunaymatata.com',
  'highendaudiogear.shop',
];

@Controller('v1/catalog/stream')
export class StreamProxyController {
  /// Obtiene un playlist HLS desde el upstream, resuelve todas las URLs
  /// relativas a absolutas y lo devuelve al player. El player se conecta
  /// DIRECTAMENTE al CDN usando esas URLs absolutas — nuestro backend solo
  /// sirve el playlist inicial (~1-2 KB), nunca los segmentos de video.
  @Get('playlist')
  async playlist(
    @Query('url') url: string,
    @Query('referer') refererParam: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }

    try {
      const upstream = await fetch(url, {
        headers: this.browserHeaders(refererParam),
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      if (!upstream.ok) {
        res.status(upstream.status).send(`Upstream ${upstream.status}`);
        return;
      }

      // La URL final después de redirects = base para resolver relativas.
      const finalUrl = upstream.url || url;
      let body = await upstream.text();

      // Si no es HLS, devolver tal cual (podría ser redirect HTML).
      if (!body.trimStart().startsWith('#EXTM3U')) {
        res.status(502).send('Not an HLS playlist');
        return;
      }

      // Resolver TODAS las URLs relativas a absolutas contra el CDN real.
      body = this.resolveRelativeUrls(body, finalUrl);

      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.send(body);
    } catch (err) {
      res.status(502).send(
        `Playlist error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /// Proxy para recursos que SÍ necesitan intermediario (tokens expirados,
  /// CDNs que bloquean por IP, etc). Usar con moderación.
  @Get('proxy')
  async proxy(
    @Query('url') url: string,
    @Query('referer') refererParam: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }

    try {
      const upstream = await fetch(url, {
        headers: this.browserHeaders(refererParam),
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      const contentType = upstream.headers.get('content-type') ?? '';

      // Si es otro playlist HLS, resolverlo también.
      const bodyText = await upstream.text();
      if (
        contentType.includes('mpegurl') ||
        bodyText.trimStart().startsWith('#EXTM3U')
      ) {
        const finalUrl = upstream.url || url;
        const resolved = this.resolveRelativeUrls(bodyText, finalUrl);
        res.set({ 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.send(resolved);
        return;
      }

      // Binario directo (video segment, image, etc).
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set({
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buffer.length),
      });
      res.send(buffer);
    } catch (err) {
      res.status(502).send(
        `Proxy error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /// Convierte todas las URLs relativas de un playlist HLS a absolutas
  /// resolviéndolas contra la URL base del playlist. El resultado es un
  /// playlist con URLs absolutas que el player puede acceder directamente.
  private resolveRelativeUrls(content: string, baseUrl: string): string {
    return content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // #EXT-X-STREAM-INF tiene URI="..." embebida
        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
          const uriMatch = line.match(/URI="([^"]+)"/);
          if (uriMatch && !uriMatch[1].startsWith('http')) {
            try {
              const abs = new URL(uriMatch[1], baseUrl).toString();
              return line.replace(uriMatch[1], abs);
            } catch { /* keep original */ }
          }
          return line;
        }

        // #EXT-X-I-FRAME-STREAM-INF también tiene URI=
        if (trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
          const uriMatch = line.match(/URI="([^"]+)"/);
          if (uriMatch && !uriMatch[1].startsWith('http')) {
            try {
              const abs = new URL(uriMatch[1], baseUrl).toString();
              return line.replace(uriMatch[1], abs);
            } catch { /* keep original */ }
          }
          return line;
        }

        // #EXT-X-MAP (init segment para fMP4)
        if (trimmed.startsWith('#EXT-X-MAP')) {
          const uriMatch = line.match(/URI="([^"]+)"/);
          if (uriMatch && !uriMatch[1].startsWith('http')) {
            try {
              const abs = new URL(uriMatch[1], baseUrl).toString();
              return line.replace(uriMatch[1], abs);
            } catch { /* keep original */ }
          }
          return line;
        }

        // Líneas que empiezan con # son comentarios/tags — dejar como están.
        if (trimmed.startsWith('#')) return line;

        // Cualquier otra línea no vacía es una URL (segmento o variante).
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          try {
            return new URL(trimmed, baseUrl).toString();
          } catch { return line; }
        }
        return line;
      })
      .join('\n');
  }

  private browserHeaders(referer?: string): Record<string, string> {
    return {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      accept: '*/*',
      ...(referer ? { referer } : {}),
    };
  }
}
