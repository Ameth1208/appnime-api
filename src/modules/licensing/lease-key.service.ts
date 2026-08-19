import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// jose is ESM-only — use dynamic import to avoid CJS/ESM conflict in nodenext
async function loadJose() {
  return await import('jose');
}
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
@Injectable()
export class LeaseKeyService implements OnModuleInit {
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  constructor(private readonly config: ConfigService) {}
  private get keyDir() { return join(resolve(this.config.get<string>('STORAGE_LOCAL_ROOT', './storage')), 'keys'); }
  async onModuleInit() {
    const { exportJWK, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI } = await loadJose();
    const privatePath = join(this.keyDir, 'lease-ed25519-private.pem');
    const publicPath = join(this.keyDir, 'lease-ed25519-public.pem');
    try {
      this.privateKey = await importPKCS8(await readFile(privatePath, 'utf8'), 'EdDSA') as CryptoKey;
      this.publicKey = await importSPKI(await readFile(publicPath, 'utf8'), 'EdDSA') as CryptoKey;
    } catch {
      const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
      this.privateKey = pair.privateKey as CryptoKey;
      this.publicKey = pair.publicKey as CryptoKey;
      await mkdir(dirname(privatePath), { recursive: true });
      await writeFile(privatePath, await exportPKCS8(pair.privateKey));
      await writeFile(publicPath, await exportSPKI(pair.publicKey));
    }
  }
  async getPublicJwk() { const { exportJWK } = await loadJose(); return { ...(await exportJWK(this.publicKey)), kid: 'appnime-lease-v1', use: 'sig', alg: 'EdDSA' }; }
  async sign(payload: Record<string, unknown>, expiresAt: Date) {
    const { SignJWT } = await loadJose();
    return new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: 'appnime-lease-v1' }).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(this.privateKey);
  }
}
