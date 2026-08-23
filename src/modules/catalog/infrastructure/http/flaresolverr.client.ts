import { execFile } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FlareSolverrResponse {
  status: string;
  message: string;
  solution?: { response: string; url?: string };
}

@Injectable()
export class FlareSolverrClient {
  private readonly logger = new Logger(FlareSolverrClient.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('FLARESOLVERR_URL') ?? '';
  }

  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  /// Descarga una página a través de FlareSolverr (resuelve challenges de
  /// Cloudflare/Incapsula con un navegador real).
  async getText(url: string, timeoutMs = 90000): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 15000),
    });
    if (!res.ok) throw new Error(`flaresolverr HTTP ${res.status}`);
    const json = (await res.json()) as FlareSolverrResponse;
    if (json.status !== 'ok' || !json.solution) {
      throw new Error(`flaresolverr: ${json.message}`);
    }
    return json.solution.response;
  }
}

export interface CurlFollowResult {
  body: string;
  finalUrl: string;
}

/// GET siguiendo redirects con curl; devuelve cuerpo y URL final.
export function curlFollow(
  url: string,
  referer: string,
  timeoutMs = 20000,
): Promise<CurlFollowResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      [
        '-s',
        '-L',
        '--max-time',
        String(Math.ceil(timeoutMs / 1000)),
        '--compressed',
        '-A',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        '-H',
        `referer: ${referer}`,
        '-w',
        '\n%{url_effective}',
        url,
      ],
      { timeout: timeoutMs + 5000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`curl fallo: ${err.message}`));
        const idx = stdout.lastIndexOf('\n');
        resolve({
          body: idx >= 0 ? stdout.slice(0, idx) : stdout,
          finalUrl: idx >= 0 ? stdout.slice(idx + 1).trim() : url,
        });
      },
    );
  });
}
