import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ProgressInput } from './history.schemas';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string) {
    const rows = await this.prisma.watchProgress.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return rows.map((row) => this.serialize(row));
  }
  async upsert(userId: string, progress: ProgressInput) {
    const row = await this.prisma.watchProgress.upsert({
      where: { userId_sourceId_contentUrl: { userId, sourceId: progress.sourceId, contentUrl: progress.contentUrl } },
      update: progress,
      create: { ...progress, userId },
    });
    return this.serialize(row);
  }
  delete(userId: string, id: string) { return this.prisma.watchProgress.deleteMany({ where: { id, userId } }); }
  private serialize<T extends { positionMs: bigint; durationMs: bigint | null }>(row: T) {
    return { ...row, positionMs: Number(row.positionMs), durationMs: row.durationMs == null ? null : Number(row.durationMs) };
  }
}
