const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function httpGetText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': DEFAULT_UA, accept: '*/*', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function httpGetJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await httpGetText(url, { ...options, headers: { accept: 'application/json', ...(options.headers ?? {}) } });
  return JSON.parse(text) as T;
}

export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size > 2000) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  async wrap(key: string, producer: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    this.set(key, value);
    return value;
  }
}
