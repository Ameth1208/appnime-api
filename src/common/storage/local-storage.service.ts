import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectStorage, PutObjectInput } from './storage.types';

@Injectable()
export class LocalStorageService extends ObjectStorage {
  constructor(private readonly config: ConfigService) { super(); }
  private get root() { return resolve(this.config.get<string>('STORAGE_LOCAL_ROOT', './storage')); }
  async put(input: PutObjectInput) {
    const safe = basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${input.namespace}/${randomUUID()}-${safe}`;
    const path = join(this.root, objectKey);
    await mkdir(join(this.root, input.namespace), { recursive: true });
    await writeFile(path, input.buffer);
    return { objectKey, sizeBytes: input.buffer.length, contentType: input.contentType, fileName: safe };
  }
  async remove(objectKey: string) { await rm(join(this.root, objectKey), { force: true }); }
  async downloadUrl(objectKey: string) {
    const base = this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '');
    return `${base}/api/v1/storage/local/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  }
  async resolvePath(objectKey: string) { return join(this.root, objectKey); }
}
