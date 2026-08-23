import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { httpGetText } from '../../http/fetcher';

const VIDLINK_BASE = 'https://vidlink.pro';
const SCRIPT_URL = `${VIDLINK_BASE}/script.js`;
const WASM_URL = `${VIDLINK_BASE}/fu.wasm`;
const CACHE_DIR = join(tmpdir(), 'appnime-vidlink');

interface Pending {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class VidlinkTokenEngine {
  private readonly logger = new Logger(VidlinkTokenEngine.name);
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private buffer = '';
  private readonly pending = new Map<string, Pending>();
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();

  async getToken(id: string): Promise<string> {
    const cached = this.tokens.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    await this.ensureStarted();
    return this.request(id);
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    this.starting ??= this.start().catch((err) => {
      this.starting = undefined;
      throw err;
    });
    await this.starting;
  }

  private async start(): Promise<void> {
    mkdirSync(CACHE_DIR, { recursive: true });
    const scriptPath = join(CACHE_DIR, 'script.js');
    const wasmPath = join(CACHE_DIR, 'fu.wasm');
    if (!existsSync(scriptPath)) {
      writeAtomic(scriptPath, await httpGetText(SCRIPT_URL, { timeoutMs: 20000 }));
    }
    if (!existsSync(wasmPath)) {
      const res = await fetch(WASM_URL, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          referer: `${VIDLINK_BASE}/movie/1`,
          accept: '*/*',
        },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`failed to download vidlink wasm: ${res.status}`);
      writeAtomic(wasmPath, Buffer.from(await res.arrayBuffer()));
    }

    const workerPath = join(process.cwd(), 'assets', 'vidlink-worker.js');
    const sodiumPath = require.resolve('libsodium-wrappers-sumo');
    this.child = spawn(process.execPath, [workerPath, scriptPath, wasmPath, sodiumPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => this.handleOutput(chunk));
    this.child.stderr!.on('data', () => undefined);
    this.child.once('exit', (code) => {
      this.child = undefined;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`vidlink worker exited (${code})`));
      }
      this.pending.clear();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('vidlink worker start timeout')), 30000);
      this.child!.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('vidlink worker died on start'));
      });
      const onReady = (chunk: string) => {
        if (chunk.includes('READY')) {
          clearTimeout(timer);
          this.child!.stdout!.off('data', onReady);
          resolve();
        }
      };
      this.child!.stdout!.on('data', onReady);
    });
    this.logger.log('Vidlink token worker started');
  }

  private handleOutput(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line || line === 'READY') continue;
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const status = line.slice(0, sp);
      const rest = line.slice(sp + 1);
      const sp2 = rest.indexOf(' ');
      const corr = sp2 >= 0 ? rest.slice(0, sp2) : rest;
      const payload = sp2 >= 0 ? rest.slice(sp2 + 1) : '';
      const p = this.pending.get(corr);
      if (!p) continue;
      this.pending.delete(corr);
      clearTimeout(p.timer);
      if (status === 'OK' && payload && payload !== 'null') {
        this.tokens.set(corr, { value: payload, expiresAt: Date.now() + 30 * 60 * 1000 });
        p.resolve(payload);
      } else {
        p.reject(new Error(`token failed: ${payload || 'null'}`));
      }
    }
  }

  private request(id: string): Promise<string> {
    if (!this.child?.stdin) return Promise.reject(new Error('vidlink worker not running'));
    const existing = this.pending.get(id);
    if (existing) {
      return new Promise<string>((resolve, reject) => {
        this.pending.set(id, {
          resolve: (t) => { existing.resolve(t); resolve(t); },
          reject: (e) => { existing.reject(e); reject(e); },
          timer: existing.timer,
        });
      });
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('vidlink token timeout'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(`${id}\n`);
    });
  }
}

function writeAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

