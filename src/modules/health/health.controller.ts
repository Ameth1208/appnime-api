import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { SkipApiKey } from '../../common/decorators/skip-api-key.decorator';

@SkipApiKey()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
  }
}
