import { BadRequestException, Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { ObjectStorage } from '../../common/storage/storage.types';
import { createTicketSchema, CreateTicketInput, messageSchema } from './support.schemas';
import { SupportService } from './support.service';

@Controller('v1/support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly storage: ObjectStorage,
  ) {}

  @Get('tickets')
  list(@CurrentUser() user: AuthPrincipal) {
    return this.support.list(user.sub);
  }

  @Post('tickets')
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput,
  ) {
    return this.support.create(user.sub, body);
  }

  @Post('tickets/:id/messages')
  message(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: { message: string; attachments?: string[] },
  ) {
    return this.support.message(user.sub, id, body.message, body.attachments);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED' });
    const saved = await this.storage.put({
      namespace: 'support',
      buffer: file.buffer,
      contentType: file.mimetype,
      fileName: file.originalname,
    });
    const url = await this.storage.downloadUrl(saved.objectKey);
    return { url, objectKey: saved.objectKey, fileName: saved.fileName, sizeBytes: saved.sizeBytes };
  }
}
