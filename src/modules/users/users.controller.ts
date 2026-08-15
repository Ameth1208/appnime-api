import { BadRequestException, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import sharp from 'sharp';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { PrismaService } from '../../common/database/prisma.service';
import { ObjectStorage } from '../../common/storage/storage.types';

@Controller('v1/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorage) {}

  @Get()
  me(@CurrentUser() user: AuthPrincipal) {
    return this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { id: true, email: true, displayName: true, avatarObjectKey: true, status: true, createdAt: true },
    });
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async avatar(@CurrentUser() user: AuthPrincipal, @UploadedFile() file?: Express.Multer.File) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException({ code: 'INVALID_AVATAR' });
    const old = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    const buffer = await sharp(file.buffer).rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    const stored = await this.storage.put({ namespace: 'avatars', fileName: 'avatar.webp', contentType: 'image/webp', buffer });
    await this.prisma.user.update({ where: { id: user.sub }, data: { avatarObjectKey: stored.objectKey } });
    if (old.avatarObjectKey) await this.storage.remove(old.avatarObjectKey);
    return { objectKey: stored.objectKey, url: await this.storage.downloadUrl(stored.objectKey) };
  }
}
