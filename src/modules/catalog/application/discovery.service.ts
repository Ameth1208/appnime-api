import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DiscoverInput, ProviderDiscoveredSource } from '../domain/types';
import { languageCodeFor } from '../infrastructure/providers/resolvers/server-resolver';

const UNLIMPLAY = 'https://unlimplay.com';
const NSRPLAY = 'https://nsrplay.space';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface EmbedsData {
  [lang: string]: { [server: string]: string };
}

/**
 * Discovery: responde "¿dónde existe este título?" sin generar URLs.
 * Lento pero infrecuente: el resultado se persiste en StreamSource.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  /// Concurrency limit para no saturar FlareSolverr/providers.
  private static readonly PROVIDER_CONCURRENCY = 3;

  constructor(private readonly config: ConfigService) {}

  async discoverAll(
    input: DiscoverInput,
    providers: string[],
    isNegativeCached: (providerId: string) => Promise<boolean>,
  ): Promise<Map<string, ProviderDiscoveredSource[]>> {
    const results = new Map<string, ProviderDiscoveredSource[]>();
    const queue = [...providers];

    const workers = Array.from(
      { length: Math.min(DiscoveryService.PROVIDER_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const providerId = queue.shift();
          if (!providerId) return;
          try {
            if (await isNegativeCached(providerId)) continue;
            const sources = await this.discover(providerId, input);
            // Entrada con [] = "existe el provider pero no tiene el título"
            // (negative cache larga). Errores transitorios NO se registran
            // aquí: quedan fuera del mapa y el caller aplica cooldown corto.
            results.set(providerId, sources);
          } catch (err) {
            this.logger.log(`discovery ${providerId} error transitorio: ${String(err).slice(0, 100)}`);
          }
        }
      },
    );
    await Promise.all(workers);
    return results;
  }

  private async discover(providerId: string, input: DiscoverInput): Promise<ProviderDiscoveredSource[]> {
    switch (providerId) {
      case 'unlimplay':
        return this.discoverUnlimplay(input);
      case 'nsrplay':
        return this.discoverNsrplay(input);
      case 'vidlink':
        return this.discoverVidlink(input);
      default:
        throw new Error(`discovery no implementado para ${providerId}`);
    }
  }

  // ── JKAnime ───────────────────────────────────────────────────────────────

  // ── UnlimPlay ─────────────────────────────────────────────────────────────

  private async discoverUnlimplay(input: DiscoverInput): Promise<ProviderDiscoveredSource[]> {
    const embedUrl =
      input.contentType === 'movie'
        ? `${UNLIMPLAY}/f/embed/movie/${input.tmdbId}`
        : `${UNLIMPLAY}/f/embed/tv/${input.tmdbId}/${input.season}/${input.episode}`;

    const res = await fetch(embedUrl, {
      headers: { 'user-agent': UA, referer: `${UNLIMPLAY}/` },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
    const html = await res.text();

    const m = html.match(/(?:const |var |let )?EMBEDS\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!m) throw new Error('EMBEDS not found');
    let data: EmbedsData;
    try {
      data = JSON.parse(m[1].replace(/\\\//g, '/')) as EmbedsData;
    } catch {
      throw new Error('invalid EMBEDS JSON');
    }

    const sources: ProviderDiscoveredSource[] = [];
    for (const [langRaw, servers] of Object.entries(data)) {
      const langName = langRaw.charAt(0).toUpperCase() + langRaw.slice(1);
      for (const [server, url] of Object.entries(servers)) {
        if (!url || !url.startsWith('http')) continue;
        const serverId = normalizeServerId(server);
        sources.push({
          tmdbId: input.tmdbId,
          contentType: input.contentType,
          seasonNum: input.season ?? 0,
          episodeNum: input.episode ?? 0,
          languageCode: languageCodeFor(langRaw),
          languageName: langName,
          providerId: 'unlimplay',
          serverId,
          providerItemId: server,
          providerUrl: url.replace(/\\\//g, '/'),
          deliveryMode: 'direct',
        });
      }
    }
    // [] = provider alcanzable pero el título no está → negative cache larga.
    return sources;
  }

  // ── NSRPlay ───────────────────────────────────────────────────────────────

  private async discoverNsrplay(input: DiscoverInput): Promise<ProviderDiscoveredSource[]> {
    const sourcesUrl =
      input.contentType === 'movie'
        ? `${NSRPLAY}/api/v1/embed/sources/movie/${input.tmdbId}`
        : `${NSRPLAY}/api/v1/embed/sources/tv/${input.tmdbId}/${input.season}/${input.episode}`;

    const res = await fetch(sourcesUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`sources HTTP ${res.status}`);
    const json = (await res.json()) as {
      servers?: { name: string; language: string; token?: string; directResolveEligible?: boolean; quality?: string }[];
    };
    const eligible = (json.servers ?? []).filter((s) => s.directResolveEligible && s.token);
    // [] = sin servidores para este título (no es un error del provider).
    if (eligible.length === 0) return [];

    return eligible.map((s) => ({
      tmdbId: input.tmdbId,
      contentType: input.contentType,
      seasonNum: input.season ?? 0,
      episodeNum: input.episode ?? 0,
      languageCode: languageCodeFor(s.language),
      languageName: s.language,
      providerId: 'nsrplay',
      serverId: normalizeServerId(s.name),
      providerItemId: s.name,
      quality: s.quality,
      deliveryMode: 'playlist_proxy' as const,
    }));
  }

  // ── VidLink ───────────────────────────────────────────────────────────────

  /// Vidlink es TMDB-keyed y barato de consultar: la fuente siempre existe.
  private discoverVidlink(input: DiscoverInput): ProviderDiscoveredSource[] {
    if ((this.config.get<string>('CATALOG_VIDLINK') ?? 'on').toLowerCase() === 'off') {
      throw new Error('vidlink deshabilitado');
    }
    void input;
    return [
      {
        tmdbId: input.tmdbId,
        contentType: input.contentType,
        seasonNum: input.season ?? 0,
        episodeNum: input.episode ?? 0,
        languageCode: 'en',
        languageName: 'Inglés',
        providerId: 'vidlink',
        serverId: 'vidlink',
        deliveryMode: 'direct',
      },
    ];
  }
}

function normalizeServerId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*\d+$/, '') // "streamwish 2" → "streamwish"
    .trim()
    .replace(/\s+/g, '-');
}
