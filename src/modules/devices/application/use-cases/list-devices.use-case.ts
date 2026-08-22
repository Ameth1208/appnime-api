import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class ListDevicesUseCase {
  constructor(private readonly prisma: PrismaService) {}
  execute(userId: string) {
    // Solo dispositivos vigentes: los revocados (quitados a mano o
    // auto-reemplazados) no deben aparecer en "Mis dispositivos".
    return this.prisma.device.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
