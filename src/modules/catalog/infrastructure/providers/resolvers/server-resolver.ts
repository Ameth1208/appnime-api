import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';

/// Resuelve una fuente conocida (provider + server + identidad estable) a
/// una URL fresca. Un resolver puede cubrir el mismo servidor en varios
/// providers (streamwish existe en unlimplay Y nsrplay).
export interface ServerResolver {
  supports(providerId: string, serverId: string): boolean;
  resolve(source: SourceCandidate): Promise<PlaybackLease[]>;
}

/// TTL conservador por servidor cuando no se puede conocer la expiración
/// real del token. Configurable por si un host cambia su ventana.
export const LEASE_TTL_MS: Record<string, number> = {
  streamwish: 8 * 60 * 1000,
  hglink: 8 * 60 * 1000,
  filemoon: 8 * 60 * 1000,
  doodstream: 20 * 60 * 1000,
  vidhide: 10 * 60 * 1000,
  voe: 10 * 60 * 1000,
  streamtape: 15 * 60 * 1000,
  vidlink: 45 * 60 * 1000,
  nsrplay: 5 * 60 * 1000, // sus tokens de stream-proxy viven muy poco
  default: 5 * 60 * 1000,
};

export function leaseTtl(serverId: string): Date {
  return new Date(Date.now() + (LEASE_TTL_MS[serverId] ?? LEASE_TTL_MS.default));
}

/// Normaliza etiquetas de idioma de providers a códigos estables.
export function languageCodeFor(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.includes('latino')) return 'es-419';
  if (n.includes('castellano') || n === 'español' || n === 'espanol' || n === 'spanish') return 'es';
  if (n.includes('ingl')) return 'en';
  if (n.includes('japon') || n === 'japanese') return 'ja';
  if (n.includes('portug')) return 'pt';
  if (n.includes('subtitulad')) return 'es-subs';
  return n.replace(/\s+/g, '-') || 'unknown';
}
