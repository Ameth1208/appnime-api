import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Readable } from 'node:stream';

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
  constructor(private readonly config: ConfigService) {}

  /// Obtiene un playlist HLS desde el upstream, resuelve todas las URLs
  /// relativas a absolutas y lo devuelve al player. El player se conecta
  /// DIRECTAMENTE al CDN usando esas URLs absolutas — nuestro backend solo
  /// sirve el playlist inicial (~1-2 KB), nunca los segmentos de video.
  ///
  /// Con `tunnel=1` (CDNs con lock de IP/ASN, p.ej. streamwish): además
  /// reescribe variantes y segmentos para que TODO el tráfico pase por
  /// `/proxy` — el CDN solo ve requests desde el servidor.
  @Get('playlist')
  async playlist(
    @Query('url') url: string,
    @Query('referer') refererParam: string | undefined,
    @Query('tunnel') tunnelParam: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    const tunnel = tunnelParam === '1';

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

      // Decidir si es playlist por Content-Type ANTES de leer el body.
      const contentType = upstream.headers.get('content-type') ?? '';
      let body: string;
      if (contentType.includes('mpegurl')) {
        body = await upstream.text();
      } else {
        body = await upstream.text();
        if (!body.trimStart().startsWith('#EXTM3U')) {
          res.status(502).send('Not an HLS playlist');
          return;
        }
      }

      // Resolver TODAS las URLs relativas a absolutas contra el CDN real.
      body = this.resolveRelativeUrls(body, finalUrl);
      if (tunnel) {
        body = this.tunnelizeUrls(body, refererParam);
      }

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
  /// CDNs que bloquean por IP/ASN, etc).
  ///
  /// - Playlists HLS: se reescriben (relativas→absolutas y/o túnel).
  /// - Binario (segmentos, MP4): STREAMING puro con soporte de Range para
  ///   seeking; nunca se bufferiza el recurso completo en RAM.
  @Get('proxy')
  async proxy(
    @Query('url') url: string,
    @Query('referer') refererParam: string | undefined,
    @Query('tunnel') tunnelParam: string | undefined,
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      res.status(400).send('Missing url');
      return;
    }
    const tunnel = tunnelParam === '1';

    try {
      // Forward de Range/If-Range para seeking y streams MP4.
      const range = headers['range'] ?? headers['Range'];
      const upstream = await fetch(url, {
        headers: {
          ...this.browserHeaders(refererParam),
          ...(range ? { range } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      const contentType = upstream.headers.get('content-type') ?? '';
      const isHlsByType = contentType.includes('mpegurl');
      const isHlsByUrl = /\.(m3u8)(\?|$)/i.test(upstream.url || url);

      if (isHlsByType || isHlsByUrl) {
        const bodyText = await upstream.text();
        if (!bodyText.trimStart().startsWith('#EXTM3U')) {
          res.status(502).send('Not an HLS playlist');
          return;
        }
        const finalUrl = upstream.url || url;
        let resolved = this.resolveRelativeUrls(bodyText, finalUrl);
        if (tunnel) resolved = this.tunnelizeUrls(resolved, refererParam);
        res.set({ 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.send(resolved);
        return;
      }

      // Binario: pipe del stream web → HTTP response sin bufferizar.
      if (!upstream.body) {
        res.status(502).send('Empty upstream body');
        return;
      }

      const passthrough: Record<string, string> = {
        'Content-Type': contentType || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      };
      for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) passthrough[h[0].toUpperCase() + h.slice(1)] = v;
      }
      res.status(upstream.status); // 200 o 206 Partial Content
      res.set(passthrough);

      const nodeStream = Readable.fromWeb(
        upstream.body as import('node:stream/web').ReadableStream,
      );
      nodeStream.pipe(res);
      // Abortar el upstream si el cliente corta la descarga.
      res.on('close', () => {
        nodeStream.destroy();
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).send(
          `Proxy error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } else {
        res.destroy();
      }
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
        if (
          trimmed.startsWith('#EXT-X-STREAM-INF') ||
          trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF') ||
          trimmed.startsWith('#EXT-X-MAP')
        ) {
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

  /// Reescribe cada URL del playlist para que pase por `/proxy`. Las URLs
  /// deben venir absolutas (aplicar `resolveRelativeUrls` antes).
  private tunnelizeUrls(content: string, referer?: string): string {
    const base = (this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/+$/, '');
    if (!base) return content;
    const proxyBase = `${base}/api/v1/catalog/stream/proxy`;
    const wrap = (raw: string): string => {
      try {
        const abs = new URL(raw).toString();
        const params = new URLSearchParams({ url: abs, tunnel: '1' });
        if (referer) params.set('referer', referer);
        return `${proxyBase}?${params.toString()}`;
      } catch {
        return raw;
      }
    };
    return content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          // URI="..." embebida en EXT-X-STREAM-INF / I-FRAME / MAP.
          const uriMatch = line.match(/URI="([^"]+)"/);
          if (uriMatch && uriMatch[1].startsWith('http')) {
            return line.replace(uriMatch[1], wrap(uriMatch[1]));
          }
          return line;
        }
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return wrap(trimmed);
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
