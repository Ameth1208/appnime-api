import type { PlaybackLease } from '../../domain/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

/// Resultado de la validación de una URL de stream.
export interface UrlValidation {
  ok: boolean;
  reason?: string;
}

/// Valida ligeramente una URL de stream antes de devolverla al cliente.
/// Costo:1 HEAD/GET de ~3-5s. Evita devolver URLs muertas al reproductor.
///
/// - MP4: HEAD request, verifica status 2xx y Content-Length > 0.
/// - HLS: GET del master m3u8, verifica que contenga `#EXTM3U`.
export async function validateStreamUrl(
  lease: PlaybackLease,
  timeoutMs = 5000,
): Promise<UrlValidation> {
  try {
    if (lease.kind === 'mp4') {
      return await validateMp4(lease.url, timeoutMs);
    }
    if (lease.kind === 'hls') {
      return await validateHls(lease.url, lease.headers, timeoutMs);
    }
    // embed u otros: no validamos (costo desconocido).
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `validate_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function validateMp4(url: string, timeoutMs: number): Promise<UrlValidation> {
  const res = await fetch(url, {
    method: 'HEAD',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) {
    return { ok: false, reason: `mp4_http_${res.status}` };
  }
  const ct = res.headers.get('content-type') ?? '';
  const cl = Number(res.headers.get('content-length') ?? '0');
  // Content-Type debe ser video/... o application/octet-stream.
  if (/^image\//i.test(ct)) {
    return { ok: false, reason: `mp4_is_image: ${ct}` };
  }
  if (cl === 0 && !ct.includes('video')) {
    return { ok: false, reason: `mp4_empty: ct=${ct}` };
  }
  return { ok: true };
}

async function validateHls(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 5000,
): Promise<UrlValidation> {
  // Rechazar URLs de variantes de solo audio (patrón vimeos.net: index-a1.m3u8).
  if (/index-a\d+\.m3u8/i.test(url) || /seg-\d+-a\d+\.ts/i.test(url)) {
    return { ok: false, reason: 'hls_audio_only_url' };
  }
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*', ...(headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) {
    return { ok: false, reason: `hls_http_${res.status}` };
  }
  const ct = res.headers.get('content-type') ?? '';
  if (/^image\//i.test(ct)) {
    return { ok: false, reason: `hls_is_image: ${ct}` };
  }
  // Leer los primeros2KB para verificar #EXTM3U.
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, reason: 'hls_no_body' };
  try {
    const { value, done } = await reader.read();
    if (done || !value) return { ok: false, reason: 'hls_empty' };
    const head = new TextDecoder().decode(value.slice(0, 2048));
    if (!head.includes('#EXTM3U')) {
      return { ok: false, reason: 'hls_not_m3u8' };
    }
    return { ok: true };
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
