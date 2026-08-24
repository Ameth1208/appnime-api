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

/// GET siguiendo redirects; devuelve cuerpo y URL final.
export async function curlFollow(
  url: string,
  referer: string,
  timeoutMs = 20000,
): Promise<CurlFollowResult> {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      referer,
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br',
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`curl fallo: HTTP ${res.status} for ${url}`);
  const body = await res.text();
  return { body, finalUrl: res.url || url };
}
