import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { ObjectStorage } from '../../common/storage/storage.types';
import { ReleaseMetaInput } from './release.schemas';

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorage) {}

  async create(meta: ReleaseMetaInput, file: Express.Multer.File) {
    const stored = await this.storage.put({
      namespace: 'releases',
      fileName: file.originalname,
      contentType: file.mimetype || 'application/octet-stream',
      buffer: file.buffer,
    });
    return this.prisma.appRelease.create({
      data: {
        ...meta,
        objectKey: stored.objectKey,
        fileName: stored.fileName,
        sizeBytes: BigInt(stored.sizeBytes),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        publishedAt: meta.published ? new Date() : null,
      },
    });
  }

  latest(platform: string, channel = 'STABLE', architecture?: string) {
    return this.prisma.appRelease.findFirst({
      where: {
        platform: platform as never,
        channel: channel as never,
        published: true,
        OR: architecture ? [{ architecture }, { architecture: null }] : undefined,
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async download(id: string) {
    const release = await this.prisma.appRelease.findUniqueOrThrow({ where: { id } });
    return {
      release,
      url: await this.storage.downloadUrl(release.objectKey, release.fileName),
      path: await this.storage.resolvePath(release.objectKey),
    };
  }

  /// Listado para el panel admin (todas las plataformas, más recientes primero).
  list(take = 50) {
    return this.prisma.appRelease.findMany({
      orderBy: { publishedAt: 'desc' },
      take,
    });
  }
}
