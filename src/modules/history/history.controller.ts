import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { HistoryService } from './history.service';
import { progressSchema, ProgressInput } from './history.schemas';

@Controller('v1/history')
@UseGuards(JwtAuthGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}
  @Get() list(@CurrentUser() user: AuthPrincipal) { return this.history.list(user.sub); }
  @Put('progress') upsert(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(progressSchema)) body: ProgressInput) {
    return this.history.upsert(user.sub, body);
  }
  @Delete(':id') delete(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) { return this.history.delete(user.sub, id); }
}
