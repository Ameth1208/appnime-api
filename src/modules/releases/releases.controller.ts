import { BadRequestException, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AdminGuard } from '../admin/admin.guard';
import { releaseMetaSchema, ReleaseMetaInput } from './release.schemas';
import { ReleasesService } from './releases.service';

@Controller('v1/releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('latest')
  async latest(@Query('platform') platform: string, @Query('channel') channel = 'STABLE', @Query('architecture') architecture?: string) {
    const release = await this.releases.latest(platform, channel, architecture);
    if (!release) return null;
    return {
      id: release.id,
      version: release.version,
      tag: release.tag,
      platform: release.platform,
      channel: release.channel,
      policy: release.policy,
      minimumVersion: release.minimumVersion,
      notes: release.notes,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes.toString(),
      publishedAt: release.publishedAt,
      downloadUrl: `/api/v1/releases/${release.id}/download`,
    };
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response) {
    const result = await this.releases.download(id);
    if (result.path) return response.download(result.path, result.release.fileName);
    return response.redirect(result.url);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  async list() {
    const releases = await this.releases.list();
    return releases.map((release) => ({
      id: release.id,
      version: release.version,
      tag: release.tag,
      platform: release.platform,
      channel: release.channel,
      architecture: release.architecture,
      policy: release.policy,
      minimumVersion: release.minimumVersion,
      notes: release.notes,
      fileName: release.fileName,
      sizeBytes: release.sizeBytes.toString(),
      published: release.published,
      publishedAt: release.publishedAt,
    }));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Query(new ZodValidationPipe(releaseMetaSchema)) meta: ReleaseMetaInput) {
    if (!file) throw new BadRequestException({ code: 'RELEASE_FILE_REQUIRED' });
    return this.releases.create(meta, file);
  }
}
