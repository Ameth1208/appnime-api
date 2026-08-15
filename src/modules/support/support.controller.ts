import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { createTicketSchema, CreateTicketInput, messageSchema } from './support.schemas';
import { SupportService } from './support.service';

@Controller('v1/support/tickets')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@CurrentUser() user: AuthPrincipal) { return this.support.list(user.sub); }
  @Post() create(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput) {
    return this.support.create(user.sub, body);
  }
  @Post(':id/messages') message(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: { message: string },
  ) { return this.support.message(user.sub, id, body.message); }
}
