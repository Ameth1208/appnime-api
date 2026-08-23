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

      // Usar la URL FINAL después de redirects como base para resolver
      // rutas relativas en el playlist HLS.
      const finalUrl = upstream.url || url;

      const contentType =
        upstream.headers.get('content-type') ?? '';

      const bodyText = await upstream.text();

      const isM3u8 =
        contentType.includes('mpegurl') ||
        finalUrl.includes('.m3u8') ||
        bodyText.trimStart().startsWith('#EXTM3U');

      if (isM3u8 && bodyText.trimStart().startsWith('#EXTM3U')) {
        const publicBase =
          process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000';
        const rewritten = this.rewriteHls(bodyText, finalUrl, referer, publicBase);
        res.set({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.send(rewritten);
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

  private rewriteHls(
    content: string,
    baseUrl: string,
    referer: string | undefined,
    proxyBase: string,
  ): string {
    return content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
          // Guardar para procesar la URL de la siguiente línea.
          return line;
        }
        if (trimmed.startsWith('#')) return line;
        try {
          // Resolver la URL relativa contra el CDN real (baseUrl).
          const abs = new URL(trimmed, baseUrl).toString();
          const ref = referer
            ? `&referer=${encodeURIComponent(referer)}`
            : '';
          return `${proxyBase}/api/v1/catalog/stream/proxy?url=${encodeURIComponent(abs)}${ref}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  }
}
