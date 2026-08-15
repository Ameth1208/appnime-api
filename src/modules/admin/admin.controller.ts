import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { GenerateActivationCodesUseCase } from '../activation-codes/application/use-cases/generate-activation-codes.use-case';
import { generateCodesSchema, GenerateCodesInput } from '../activation-codes/activation-code.schemas';
import { ManualPaymentService } from '../payments/manual-payment.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AdminGuard } from './admin.guard';
import { accountStatusSchema, adminTicketMessageSchema, manualPaymentSchema, ticketStatusSchema } from './admin.schemas';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: ManualPaymentService,
    private readonly generateCodes: GenerateActivationCodesUseCase,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get('accounts')
  accounts(@Query('q') q?: string) {
    return this.prisma.account.findMany({
      where: q ? { OR: [{ owner: { email: { contains: q, mode: 'insensitive' } } }, { id: { contains: q } }] } : undefined,
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { members: true, devices: true } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('accounts/:id/status')
  async status(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(accountStatusSchema)) body: { status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'CLOSED' },
  ) {
    const account = await this.prisma.account.update({ where: { id }, data: { status: body.status } });
    await this.prisma.auditLog.create({ data: { actorUserId: admin.sub, accountId: id, action: 'ACCOUNT_STATUS_CHANGED', targetType: 'Account', targetId: id, metadata: { status: body.status } } });
    if (body.status !== 'ACTIVE') {
      await this.prisma.usageSession.updateMany({ where: { device: { accountId: id }, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    }
    this.realtime.emitAccount(id, 'account.access.changed', { status: body.status });
    return account;
  }

  @Post('payments/manual')
  async manual(
    @CurrentUser() admin: AuthPrincipal,
    @Body(new ZodValidationPipe(manualPaymentSchema)) body: { accountId: string; planId: string; amountCents: number; reference?: string },
  ) {
    const result = await this.payments.record({ ...body, adminUserId: admin.sub });
    await this.prisma.auditLog.create({ data: { actorUserId: admin.sub, accountId: body.accountId, action: 'MANUAL_PAYMENT_RECORDED', targetType: 'Payment', targetId: result.payment.id, metadata: { amountCents: body.amountCents } } });
    this.realtime.emitAccount(body.accountId, 'subscription.updated', { subscriptionId: result.subscription.id });
    return result;
  }

  @Post('activation-code-batches')
  activationCodes(@CurrentUser() admin: AuthPrincipal, @Body(new ZodValidationPipe(generateCodesSchema)) body: GenerateCodesInput) {
    return this.generateCodes.execute(admin.sub, body);
  }

  @Get('support/tickets')
  supportTickets(@Query('status') status?: string) {
    return this.prisma.supportTicket.findMany({
      where: status ? { status: status as never } : undefined,
      include: { user: { select: { id: true, email: true, displayName: true } }, messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  @Patch('support/tickets/:id/status')
  supportStatus(@Param('id') id: string, @Body(new ZodValidationPipe(ticketStatusSchema)) body: { status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED' }) {
    return this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
  }

  @Post('support/tickets/:id/messages')
  async supportMessage(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminTicketMessageSchema)) body: { message: string },
  ) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    const message = await this.prisma.supportMessage.create({ data: { ticketId: id, senderId: admin.sub, senderRole: 'ADMIN', message: body.message } });
    this.realtime.emitUser(ticket.userId, 'support.message', { ticketId: id, messageId: message.id });
    return message;
  }
}
