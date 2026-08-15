import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Controller('v1/plans')
export class PlansController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  list() {
    return this.prisma.plan.findMany({ where: { active: true, public: true }, orderBy: { priceCents: 'asc' } });
  }
}
