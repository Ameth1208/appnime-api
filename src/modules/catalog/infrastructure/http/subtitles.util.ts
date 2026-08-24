import type { SubtitleTrack } from '../../domain/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

/// Detecta pistas de subtítulos declaradas en un manifiesto HLS master
/// (`EXT-X-MEDIA:TYPE=SUBTITLES`). Best-effort: si el fetch falla o no hay
/// pistas, devuelve [] sin propagar errores.
export async function detectHlsSubtitles(
  manifestUrl: string,
  headers?: Record<string, string>,
  timeoutMs = 8000,
): Promise<SubtitleTrack[]> {
  try {
    const res = await fetch(manifestUrl, {
      headers: { 'user-agent': UA, accept: '*/*', ...(headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.includes('TYPE=SUBTITLES')) return [];
    const tracks: SubtitleTrack[] = [];
    for (const m of text.matchAll(/#EXT-X-MEDIA:TYPE=SUBTITLES[^\r\n]*/gi)) {
      const line = m[0];
      const name = line.match(/NAME="([^"]+)"/i)?.[1];
      const lang = line.match(/LANGUAGE="([^"]+)"/i)?.[1];
      const uri = line.match(/URI="([^"]+)"/i)?.[1];
      if (!uri) continue;
      try {
        tracks.push({
          language: (lang ?? name ?? 'sub').toLowerCase(),
          title: name ?? lang,
          url: new URL(uri, res.url || manifestUrl).toString(),
        });
      } catch {
        continue;
      }
    }
    // Únicos por URL, máximo 6.
    const seen = new Set<string>();
    return tracks.filter((t) => !seen.has(t.url) && seen.add(t.url)).slice(0, 6);
  } catch {
    return [];
  }
}
