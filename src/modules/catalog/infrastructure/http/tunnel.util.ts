/// Hosts cuyos streams HLS llegan con lock de IP/ASN (el token solo sirve
/// desde la IP que lo extrajo). Su tráfico DEBE tunelizarse por el proxy
/// del backend; todo lo demás va directo Flutter → CDN.
export const TUNNEL_HOST_SUFFIXES = [
  'premilkyway.com', // streamwish / hglink
  'streamwish.to',
  'hglink.to',
  'dramiyos-cdn.com', // unlimplay CDN (IP-locked tokens)
];

export function needsTunnel(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return TUNNEL_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`) || host.endsWith(s));
  } catch {
    return false;
  }
}

/// Envuelve una URL en el playlist-proxy del backend. Incluye la API key
/// como query para que el reproductor no necesite headers custom.
/// Devuelve null si no hay PUBLIC_BASE_URL configurada.
export function wrapPlaylistProxy(
  url: string,
  referer: string,
  options: { tunnel?: boolean } = {},
): string | null {
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return null;
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  if (options.tunnel) params.set('tunnel', '1');
  const apiKey = process.env.CATALOG_API_KEY ?? '';
  if (apiKey) params.set('key', apiKey);
  return `${base}/api/v1/catalog/stream/playlist?${params.toString()}`;
}

/// Aplica túnel SOLO si el host lo necesita; si no, devuelve la URL directa.
export function tunnelIfLocked(url: string, referer: string): string {
  if (!needsTunnel(url)) return url;
  return wrapPlaylistProxy(url, referer, { tunnel: true }) ?? url;
}
