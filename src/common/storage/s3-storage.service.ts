import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectStorage, PutObjectInput } from './storage.types';

@Injectable()
export class S3StorageService extends ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(private readonly config: ConfigService) {
    super();
    this.bucket = config.get<string>('S3_BUCKET', '');
    this.client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT') || undefined,
      region: config.get<string>('S3_REGION', 'auto'),
      forcePathStyle: Boolean(config.get<string>('S3_ENDPOINT')),
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY', ''),
      },
    });
  }
  async put(input: PutObjectInput) {
    const safe = basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${input.namespace}/${randomUUID()}-${safe}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: input.buffer, ContentType: input.contentType }));
    return { objectKey, sizeBytes: input.buffer.length, contentType: input.contentType, fileName: safe };
  }
  async remove(objectKey: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })); }
  async downloadUrl(objectKey: string, fileName?: string) {
    const publicBase = this.config.get<string>('S3_PUBLIC_BASE_URL');
    if (publicBase) return `${publicBase.replace(/\/$/, '')}/${objectKey}`;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, ResponseContentDisposition: fileName ? `attachment; filename="${fileName}"` : undefined });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }
  async resolvePath() { return await Promise.resolve(null); }
}
