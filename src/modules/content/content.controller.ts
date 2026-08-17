import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Controller('v1')
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('terms/latest')
  async latestTerms() {
    const terms = await this.prisma.termsVersion.findFirst({ where: { published: true }, orderBy: { publishedAt: 'desc' } });
    if (!terms) throw new NotFoundException({ code: 'TERMS_NOT_FOUND' });
    return terms;
  }

  @Get('promotions/:code')
  async promotion(@Param('code') code: string) {
    const normalized = code.trim().toUpperCase();
    const promo = await this.prisma.promotion.findUnique({ where: { code: normalized } });
    if (!promo || !promo.active) throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND' });
    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) throw new NotFoundException({ code: 'PROMOTION_NOT_STARTED' });
    if (promo.expiresAt && promo.expiresAt < now) throw new NotFoundException({ code: 'PROMOTION_EXPIRED' });
    if (promo.maxRedemptions != null && promo.usedCount >= promo.maxRedemptions) throw new NotFoundException({ code: 'PROMOTION_EXHAUSTED' });
    return promo;
  }
}
