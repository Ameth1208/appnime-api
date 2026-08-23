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

    const parsed = new URL(url);
    const hostOk = ALLOWED_HOSTS.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
    );
    if (!hostOk) {
      res.status(403).send('Host not allowed');
      return;
    }

    const referer = refererParam || `${parsed.protocol}//${parsed.host}/`;

    try {
      const upstream = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
          accept: '*/*',
          referer,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      if (!upstream.ok) {
        res.status(upstream.status).send(`Upstream ${upstream.status}`);
        return;
      }

      const contentType =
        upstream.headers.get('content-type') ?? '';

      // Detectar si es un playlist HLS para reescribir las URLs internas.
      const isM3u8 =
        contentType.includes('mpegurl') ||
        contentType.includes('text/plain') ||
        url.includes('.m3u8');

      if (isM3u8) {
        let body = await upstream.text();
        // Verificar que realmente sea HLS.
        if (!body.trimStart().startsWith('#EXTM3U')) {
          res.status(502).send('Not an HLS playlist');
          return;
        }
        body = this.rewriteHls(body, url, referer);
        res.set({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        });
        res.send(body);
        return;
      }

      // Segmentos binarios u otros recursos: pasar directamente.
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set({
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'Access-Control-Allow-Origin': '*',
      });
      res.send(buffer);
    } catch (err) {
      res.status(502).send(
        `Proxy error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /// Reescribe las líneas de un playlist HLS para que cada segmento pase por
  /// este mismo proxy. Esto permite que el player reproduzca contenido de
  /// CDNs que bloquean conexiones directas sin navegador.
  private rewriteHls(content: string, baseUrl: string, referer?: string): string {
    return content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          // Reescribir sub-playlists embebidas (#EXT-X-STREAM-INF seguido de URL)
          return line;
        }
        // Línea de segmento o sub-playlist: envolver en proxy.
        try {
          const abs = new URL(trimmed, baseUrl).toString();
          const ref = referer
            ? `&referer=${encodeURIComponent(referer)}`
            : '';
          return `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000'}/api/v1/catalog/stream/proxy?url=${encodeURIComponent(abs)}${ref}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  }
}
