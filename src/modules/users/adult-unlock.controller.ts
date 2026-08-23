import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { CurrentUser } from '../../common/security/current-user.decorator';

@Controller('v1/me')
export class AdultUnlockController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('adult-status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@CurrentUser('id') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { adultUnlocked: true },
    });
    return { adultUnlocked: user?.adultUnlocked ?? false };
  }

  @Patch('adult-unlock')
  @UseGuards(JwtAuthGuard)
  async toggle(
    @CurrentUser('id') userId: string,
    @Body() body: { password: string; unlock: boolean },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) return { success: false, message: 'User not found' };

    // Verificar contraseña con argon2
    const argon2 = require('argon2');
    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) return { success: false, message: 'Invalid password' };

    await this.prisma.user.update({
      where: { id: userId },
      data: { adultUnlocked: body.unlock },
    });
    return { success: true, adultUnlocked: body.unlock };
  }
}
