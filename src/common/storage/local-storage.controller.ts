import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';

@Controller('v1/storage/local')
export class LocalStorageController {
  constructor(private readonly storage: LocalStorageService, private readonly config: ConfigService) {}
  @Get(':namespace/:file')
  async get(@Param('namespace') namespace: string, @Param('file') file: string, @Res() response: Response) {
    if (this.config.get('STORAGE_DRIVER') !== 'local') throw new NotFoundException();
    if (!['avatars', 'releases'].includes(namespace)) throw new NotFoundException();
    const filePath = await this.storage.resolvePath(`${namespace}/${file}`);
    return response.sendFile(filePath);
  }
}
