import { Injectable } from '@nestjs/common';

/**
 * Desempaqua JavaScript ofuscado con Dean Edwards' packer.
 * Patrón: eval(function(p,a,c,k,e,d){...}('payload',radix,count,'kw1|kw2'.split('|'),0,{}))
 */
@Injectable()
export class JsUnpacker {
  /// Busca y desempaqua todos los bloques packed en el código fuente.
  static unpackAll(source: string): string[] {
    const results: string[] = [];
    const regex = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(\s*(['"])\s*\|\s*\7\s*\)/;
    let match = regex.exec(source);
    while (match) {
      try {
        const payload = match[2];
        const radix = parseInt(match[3]);
        const count = parseInt(match[4]);
        const keywords = match[6].split('|');
        const unpacked = JsUnpacker.unpack(payload, radix, count, keywords);
        if (unpacked) results.push(unpacked);
      } catch {
        // Continúa con el siguiente bloque
      }
      // Buscar siguiente
      const rest = source.substring((match.index ?? 0) + match[0].length);
      const next = regex.exec(rest);
      if (next) {
        next.index = (match.index ?? 0) + match[0].length + next.index;
      }
      match = next;
    }
    return results;
  }

  private static unpack(
    payload: string,
    radix: number,
    count: number,
    keywords: string[],
  ): string | null {
    try {
      // Reemplaza cada token por su keyword correspondiente
      const unescaped = payload.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return unescaped.replace(/\b(\w+)\b/g, (word) => {
        const idx = parseInt(word, radix);
        if (!isNaN(idx) && idx < keywords.length && idx >= 0) {
          return keywords[idx] || word;
        }
        return word;
      });
    } catch {
      return null;
    }
  }

  /// Extrae la primera URL de stream (m3u8/mp4) de un texto.
  static extractStreamUrl(text: string): string | null {
    const patterns = [
      /["'](https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)["']/i,
      /["'](https?:\/\/[^"'\s]+?\.mp4[^"'\s]*)["']/i,
      /file:\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /source:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  /// Pipeline: busca bloques packed, los desempaqueta y extrae URLs de stream.
  static extractFromPacked(source: string): string[] {
    const unpackedBlocks = this.unpackAll(source);
    const urls: string[] = [];
    for (const block of unpackedBlocks) {
      const url = this.extractStreamUrl(block);
      if (url) urls.push(url);
    }
    // Si no hay bloques packed, buscar directamente en el source
    if (urls.length === 0) {
      const direct = this.extractStreamUrl(source);
      if (direct) urls.push(direct);
    }
    return urls;
  }
}
