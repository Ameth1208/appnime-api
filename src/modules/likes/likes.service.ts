import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LikeInput } from './likes.schemas';

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(userId: string) {
    return this.prisma.contentLike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async like(userId: string, input: LikeInput) {
    const created = await this.prisma.contentLike.upsert({
      where: { userId_sourceId_contentUrl: { userId, sourceId: input.sourceId, contentUrl: input.contentUrl } },
      update: { title: input.title, imageUrl: input.imageUrl, contentKind: input.contentKind },
      create: { ...input, userId },
    });
    this.realtime.emitAdmin('admin.like.created', created);
    return created;
  }

  async unlike(userId: string, sourceId: string, contentUrl: string) {
    const deleted = await this.prisma.contentLike.deleteMany({ where: { userId, sourceId, contentUrl } });
    if (deleted.count > 0) {
      this.realtime.emitAdmin('admin.like.removed', { userId, sourceId, contentUrl });
    }
    return { removed: deleted.count > 0 };
  }
}
