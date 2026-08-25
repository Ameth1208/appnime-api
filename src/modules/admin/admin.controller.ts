import { SkipApiKey } from '../../common/decorators/skip-api-key.decorator';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccountStatus, DevicePlatform, DeviceStatus, PaymentProviderKind, PaymentStatus, Prisma, SubscriptionStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { GenerateActivationCodesUseCase } from '../activation-codes/application/use-cases/generate-activation-codes.use-case';
import { generateCodesSchema, GenerateCodesInput } from '../activation-codes/activation-code.schemas';
import { AdminDeviceLinkUseCase } from '../device-links/application/use-cases/admin-device-link.use-case';
import { AdminInviteMemberUseCase } from '../members/application/use-cases/admin-invite-member.use-case';
import { ManualPaymentService } from '../payments/manual-payment.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AdminGuard, SuperAdminGuard } from './admin.guard';
import { accountStatusSchema, adminChangePasswordSchema, adminCreateUserSchema, adminDeviceLinkSchema, adminInviteSchema, adminNotifySchema, adminSetRoleSchema, adminTicketMessageSchema, announcementSchema, manualPaymentSchema, paymentStatusSchema, promotionCreateSchema, promotionUpdateSchema, subscriptionUpdateSchema, termsCreateSchema, ticketStatusSchema } from './admin.schemas';

@SkipApiKey()
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: ManualPaymentService,
    private readonly generateCodes: GenerateActivationCodesUseCase,
    private readonly realtime: RealtimeGateway,
    private readonly adminInvite: AdminInviteMemberUseCase,
    private readonly adminDeviceLink: AdminDeviceLinkUseCase,
  ) {}

  @Get('accounts')
  accounts(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize = '25',
  ) {
    const where: Prisma.AccountWhereInput = {
      ...(q ? { OR: [{ owner: { email: { contains: q, mode: 'insensitive' } } }, { id: { contains: q } }] } : {}),
      ...(status && status !== 'ALL' ? { status: status as AccountStatus } : {}),
    };
    const include = {
      owner: { select: { id: true, email: true, displayName: true } },
      subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { members: true, devices: true } },
    } as const;
    if (!page) {
      return this.prisma.account.findMany({ where, include, take: 100, orderBy: { createdAt: 'desc' } });
    }
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    return this.prisma.$transaction([
      this.prisma.account.count({ where }),
      this.prisma.account.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (current - 1) * size, take: size }),
    ]).then(([total, data]) => ({ data, total, page: current, pageSize: size }));
  }

  @Get('accounts/:id')
  accountDetail(@Param('id') id: string) {
    return this.prisma.account.findUniqueOrThrow({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 3 },
        members: { include: { user: { select: { id: true, email: true, displayName: true, status: true } } }, orderBy: { joinedAt: 'desc' } },
        invitations: { orderBy: { createdAt: 'desc' }, take: 20 },
        devices: { orderBy: { lastSeenAt: 'desc' }, take: 20 },
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { members: true, devices: true } },
      },
    });
  }

  @Get('subscriptions')
  async subscriptions(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const where: Prisma.SubscriptionWhereInput = {
      ...(status && status !== 'ALL' ? { status: status as SubscriptionStatus } : {}),
      ...(q ? { account: { owner: { email: { contains: q, mode: 'insensitive' } } } } : {}),
    };
    const include = {
      plan: true,
      account: { select: { id: true, owner: { select: { id: true, email: true, displayName: true } } } },
    } as const;
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const [total, data] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
      }),
    ]);
    return { data, total, page: current, pageSize: size };
  }

  @Post('users')
  async createUser(
    @CurrentUser() admin: AuthPrincipal,
    @Body(new ZodValidationPipe(adminCreateUserSchema))
    body: {
      email: string;
      password: string;
      displayName?: string;
      isAdmin: boolean;
      adminRole?: 'SUPER_ADMIN' | 'ADMIN' | 'RESELLER';
      permissions?: string[];
    },
  ) {
    const { hash } = await import('argon2');
    const existing = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }
    const passwordHash = await hash(body.password);
    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        isAdmin: body.isAdmin,
        adminRole: body.isAdmin ? (body.adminRole ?? 'ADMIN') : null,
        permissions: body.permissions ?? [],
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        isAdmin: true,
        adminRole: true,
        permissions: true,
        createdAt: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.sub,
        action: 'ADMIN_USER_CREATED',
        targetType: 'User',
        targetId: user.id,
        metadata: { email: user.email, isAdmin: user.isAdmin, adminRole: user.adminRole, permissions: user.permissions },
      },
    });
    return user;
  }

  @Patch('users/:id/password')
  async changePassword(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminChangePasswordSchema)) body: { password: string },
  ) {
    const { hash } = await import('argon2');
    const passwordHash = await hash(body.password);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    // Invalidar sesiones del usuario (salvo la propia si es el mismo admin).
    await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null, ...(id === admin.sub ? { id: { not: admin.sessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'USER_PASSWORD_CHANGED', targetType: 'User', targetId: id, metadata: { byAdmin: admin.sub !== id } },
    });
    return { ok: true };
  }

  @Patch('users/:id/role')
  async setRole(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminSetRoleSchema))
    body: {
      isAdmin: boolean;
      adminRole?: 'SUPER_ADMIN' | 'ADMIN' | 'RESELLER' | null;
      permissions?: string[];
    },
  ) {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        isAdmin: body.isAdmin,
        adminRole: body.isAdmin ? (body.adminRole ?? 'ADMIN') : null,
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        isAdmin: true,
        adminRole: true,
        permissions: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.sub,
        action: 'USER_ROLE_CHANGED',
        targetType: 'User',
        targetId: id,
        metadata: { isAdmin: body.isAdmin, adminRole: body.adminRole, permissions: user.permissions },
      },
    });
    return user;
  }

  @Get('resellers/summary')
  async resellersSummary() {
    const batches = await this.prisma.activationCodeBatch.findMany({
      where: { reseller: { not: null } },
      include: {
        codes: {
          select: { status: true, valueCents: true },
        },
      },
    });

    const summaryMap = new Map<
      string,
      {
        resellerName: string;
        batchesCount: number;
        totalCodesCount: number;
        redeemedCodesCount: number;
        availableCodesCount: number;
        totalGeneratedCents: number;
        totalRedeemedCents: number;
      }
    >();

    for (const batch of batches) {
      const resellerName = batch.reseller?.trim();
      if (!resellerName) continue;

      const current = summaryMap.get(resellerName) ?? {
        resellerName,
        batchesCount: 0,
        totalCodesCount: 0,
        redeemedCodesCount: 0,
        availableCodesCount: 0,
        totalGeneratedCents: 0,
        totalRedeemedCents: 0,
      };

      current.batchesCount += 1;
      for (const code of batch.codes) {
        current.totalCodesCount += 1;
        current.totalGeneratedCents += code.valueCents;
        if (code.status === 'REDEEMED') {
          current.redeemedCodesCount += 1;
          current.totalRedeemedCents += code.valueCents;
        } else if (code.status === 'AVAILABLE') {
          current.availableCodesCount += 1;
        }
      }

      summaryMap.set(resellerName, current);
    }

    return Array.from(summaryMap.values());
  }

  @Post('accounts/:id/invitations')
  async invite(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminInviteSchema)) body: { email: string },
  ) {
    const result = await this.adminInvite.execute(admin.sub, id, body.email);
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, accountId: id, action: 'MEMBER_INVITED', targetType: 'Invitation', metadata: { email: body.email } },
    });
    return result;
  }

  @Post('accounts/:id/device-links')
  async deviceLink(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminDeviceLinkSchema)) body: { deviceName?: string; brand?: string; model?: string },
  ) {
    const result = await this.adminDeviceLink.execute(id, body);
    this.realtime.emitAccount(id, 'device-link.requested', { code: result.code, qrUrl: result.qrUrl, expiresAt: result.expiresAt });
    return result;
  }

  @Post('users/:id/notify')
  async notifyUser(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminNotifySchema)) body: { message: string },
  ) {
    await this.prisma.user.findUniqueOrThrow({ where: { id } });
    this.realtime.emitUser(id, 'admin.notification', { message: body.message, at: new Date().toISOString() });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'USER_NOTIFIED', targetType: 'User', targetId: id, metadata: { message: body.message } },
    });
    return { ok: true };
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

  @Patch('payments/:id/status')
  async paymentStatus(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paymentStatusSchema)) body: { status: PaymentStatus },
  ) {
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.status === 'PAID' && !current.paidAt ? { paidAt: new Date() } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.sub,
        accountId: payment.accountId,
        action: 'PAYMENT_STATUS_CHANGED',
        targetType: 'Payment',
        targetId: id,
        metadata: { from: current.status, status: body.status },
      },
    });
    return payment;
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

  @Get('activation-code-batches')
  async activationCodeBatches(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('q') q?: string,
    @Query('campaign') campaign?: string,
    @Query('reseller') reseller?: string,
    @Query('createdById') createdById?: string,
  ) {
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const where: Prisma.ActivationCodeBatchWhereInput = {
      ...(campaign ? { campaign: { contains: campaign, mode: 'insensitive' } } : {}),
      ...(reseller ? { reseller: { contains: reseller, mode: 'insensitive' } } : {}),
      ...(createdById ? { createdById } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { campaign: { contains: q, mode: 'insensitive' } },
              { reseller: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.activationCodeBatch.count({ where }),
      this.prisma.activationCodeBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
        include: {
          _count: { select: { codes: true } },
          codes: {
            include: { plan: { select: { name: true } } },
          },
        },
      }),
    ]);
    // Enriquecer con info del creador
    const creatorIds = [...new Set(data.map((b) => b.createdById).filter(Boolean))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds as string[] } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    const creatorMap = new Map(creators.map((c) => [c.id, c]));
    return {
      total,
      page: current,
      pageSize: size,
      data: data.map((batch) => {
        const creator = batch.createdById ? creatorMap.get(batch.createdById) : null;
        const totalValueCents = batch.codes.reduce((sum, c) => sum + c.valueCents, 0);
        const redeemedCount = batch.codes.filter((c) => c.status === 'REDEEMED').length;
        const sampleCode = batch.codes[0];
        return {
          id: batch.id,
          name: batch.name,
          campaign: batch.campaign,
          reseller: batch.reseller,
          notes: batch.notes,
          createdAt: batch.createdAt,
          totalCodes: batch._count.codes,
          redeemedCodes: redeemedCount,
          totalValueCents,
          createdBy: creator?.displayName ?? creator?.email ?? null,
          createdById: batch.createdById,
          planName: sampleCode?.plan?.name ?? null,
          kind: sampleCode?.kind ?? null,
          durationUnit: sampleCode?.durationUnit ?? null,
          durationValue: sampleCode?.durationValue ?? null,
        };
      }),
    };
  }

  @Get('activation-codes')
  async activationCodesList(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('batchId') batchId?: string,
    @Query('campaign') campaign?: string,
    @Query('reseller') reseller?: string,
    @Query('createdById') createdById?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const where: Prisma.ActivationCodeWhereInput = {
      ...(status && status !== 'ALL' ? { status: status as never } : {}),
      ...(kind && kind !== 'ALL' ? { kind: kind as never } : {}),
      ...(batchId ? { batchId } : {}),
      ...(campaign ? { batch: { campaign: { contains: campaign, mode: 'insensitive' } } } : {}),
      ...(reseller ? { batch: { reseller: { contains: reseller, mode: 'insensitive' } } } : {}),
      ...(createdById ? { batch: { createdById } } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { codePrefix: { contains: q, mode: 'insensitive' } },
              { batch: { name: { contains: q, mode: 'insensitive' } } },
              { batch: { campaign: { contains: q, mode: 'insensitive' } } },
              { batch: { reseller: { contains: q, mode: 'insensitive' } } },
              { redemption: { user: { email: { contains: q, mode: 'insensitive' } } } },
              { redemption: { user: { displayName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.activationCode.count({ where }),
      this.prisma.activationCode.findMany({
        where,
        include: {
          batch: {
            select: { id: true, name: true, campaign: true, reseller: true, createdById: true },
          },
          plan: { select: { id: true, name: true } },
          redemption: {
            include: { user: { select: { id: true, email: true, displayName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
      }),
    ]);
    const creatorIds = [...new Set(data.map((c) => c.batch?.createdById).filter(Boolean))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds as string[] } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    const creatorMap = new Map(creators.map((c) => [c.id, c]));
    return {
      total,
      page: current,
      pageSize: size,
      data: data.map((c) => {
        const creator = c.batch?.createdById ? creatorMap.get(c.batch.createdById) : null;
        return {
          id: c.id,
          code: c.code ?? c.codePrefix,
          codePrefix: c.codePrefix,
          kind: c.kind,
          status: c.status,
          valueCents: c.valueCents,
          durationUnit: c.durationUnit,
          durationValue: c.durationValue,
          redemptionExpiresAt: c.redemptionExpiresAt,
          createdAt: c.createdAt,
          redeemedAt: c.redeemedAt,
          batchId: c.batchId,
          batchName: c.batch?.name ?? null,
          campaign: c.batch?.campaign ?? null,
          reseller: c.batch?.reseller ?? null,
          createdBy: creator?.displayName ?? creator?.email ?? null,
          plan: c.plan,
          redeemedByUser: c.redemption?.user ?? null,
        };
      }),
    };
  }

  @Post('activation-code-batches')
  @UseGuards(SuperAdminGuard)
  async activationCodes(@CurrentUser() admin: AuthPrincipal, @Body(new ZodValidationPipe(generateCodesSchema)) body: GenerateCodesInput) {
    const result = await this.generateCodes.execute(admin.sub, body);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.sub,
        action: 'ACTIVATION_CODES_GENERATED',
        targetType: 'ActivationCodeBatch',
        targetId: result.batchId,
        metadata: {
          name: body.name,
          planId: body.planId,
          kind: body.kind,
          quantity: body.quantity,
          campaign: body.campaign,
        },
      },
    });
    return result;
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
  async supportStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ticketStatusSchema)) body: { status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED' },
  ) {
    const ticket = await this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
    this.realtime.emitAdmin('admin.support.ticket.updated', { id: ticket.id, ticketId: ticket.id, status: ticket.status });
    this.realtime.emitUser(ticket.userId, 'support.ticket.updated', { id: ticket.id, ticketId: ticket.id, status: ticket.status });
    return ticket;
  }

  @Post('support/tickets/:id/messages')
  async supportMessage(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminTicketMessageSchema)) body: { message: string; attachments?: string[] },
  ) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId: id,
        senderId: admin.sub,
        senderRole: 'ADMIN',
        message: body.message,
        attachments: body.attachments ?? [],
      },
    });
    const payload = {
      id: message.id,
      ticketId: id,
      senderRole: 'ADMIN',
      message: message.message,
      attachments: message.attachments,
      createdAt: message.createdAt,
    };
    this.realtime.emitUser(ticket.userId, 'support.message', payload);
    this.realtime.emitAdmin('admin.support.message', payload);
    return message;
  }

  @Get('activation-code-batches/:id')
  async activationCodeBatchDetail(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));

    const batch = await this.prisma.activationCodeBatch.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        campaign: true,
        reseller: true,
        notes: true,
        createdAt: true,
        createdById: true,
      },
    });

    const baseWhere: Prisma.ActivationCodeWhereInput = {
      batchId: id,
      ...(status && status !== 'ALL' ? { status: status as never } : {}),
      ...(kind && kind !== 'ALL' ? { kind: kind as never } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { codePrefix: { contains: q, mode: 'insensitive' } },
              { redemption: { user: { email: { contains: q, mode: 'insensitive' } } } },
              { redemption: { user: { displayName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [filteredTotal, allCodesCount, availableCount, redeemedCount, expiredCount, codes] =
      await this.prisma.$transaction([
        this.prisma.activationCode.count({ where: baseWhere }),
        this.prisma.activationCode.count({ where: { batchId: id } }),
        this.prisma.activationCode.count({ where: { batchId: id, status: 'AVAILABLE' } }),
        this.prisma.activationCode.count({ where: { batchId: id, status: 'REDEEMED' } }),
        this.prisma.activationCode.count({ where: { batchId: id, status: 'EXPIRED' } }),
        this.prisma.activationCode.findMany({
          where: baseWhere,
          include: {
            plan: { select: { name: true } },
            redemption: {
              include: { user: { select: { email: true, displayName: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip: (current - 1) * size,
          take: size,
        }),
      ]);

    const creator = batch.createdById
      ? await this.prisma.user.findUnique({
          where: { id: batch.createdById },
          select: { id: true, email: true, displayName: true },
        })
      : null;

    return {
      id: batch.id,
      name: batch.name,
      campaign: batch.campaign,
      reseller: batch.reseller,
      notes: batch.notes,
      createdAt: batch.createdAt,
      createdBy: creator?.displayName ?? creator?.email ?? null,
      createdById: batch.createdById,
      totalCodes: allCodesCount,
      availableCodes: availableCount,
      redeemedCodes: redeemedCount,
      expiredCodes: expiredCount,
      filteredTotal,
      page: current,
      pageSize: size,
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code ?? c.codePrefix,
        codePrefix: c.codePrefix,
        kind: c.kind,
        status: c.status,
        valueCents: c.valueCents,
        durationUnit: c.durationUnit,
        durationValue: c.durationValue,
        redemptionExpiresAt: c.redemptionExpiresAt,
        plan: c.plan,
        redeemedByUser: c.redemption?.user ?? null,
        redeemedAt: c.redeemedAt,
        createdAt: c.createdAt,
      })),
    };
  }

  @Get('users/:id')
  async userDetail(@Param('id') id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, displayName: true, status: true, isAdmin: true, createdAt: true },
    });
    const [memberships, ownedAccounts, devices, invitationsSent, invitationsFor, likes, createdBatches, redemptions] = await this.prisma.$transaction([
      this.prisma.accountMember.findMany({
        where: { userId: id },
        include: {
          account: {
            select: {
              id: true,
              status: true,
              owner: { select: { id: true, email: true, displayName: true } },
              subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      }),
      this.prisma.account.findMany({ where: { ownerUserId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.device.findMany({
        where: { userId: id },
        include: { account: { select: { id: true, owner: { select: { email: true, displayName: true } } } } },
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
      }),
      this.prisma.invitation.findMany({ where: { createdById: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.invitation.findMany({ where: { email: user.email }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.contentLike.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.activationCodeBatch.findMany({
        where: { createdById: id },
        include: { _count: { select: { codes: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.activationRedemption.findMany({
        where: { userId: id },
        include: {
          activationCode: {
            include: { plan: { select: { name: true } }, batch: { select: { name: true, campaign: true, reseller: true } } },
          },
        },
        orderBy: { redeemedAt: 'desc' },
        take: 50,
      }),
    ]);
    const accountIds = [...new Set([...memberships.map((member) => member.accountId), ...ownedAccounts.map((account) => account.id)])];
    const payments = accountIds.length
      ? await this.prisma.payment.findMany({
          where: { accountId: { in: accountIds } },
          include: { account: { select: { id: true, owner: { select: { email: true, displayName: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];
    return { ...user, memberships, ownedAccounts, devices, payments, invitationsSent, invitationsFor, likes, createdBatches, redemptions };
  }

  @Get('likes/top')
  async topLikes() {
    const rows = await this.prisma.contentLike.groupBy({
      by: ['sourceId', 'contentUrl'],
      _count: { _all: true },
      _max: { title: true, imageUrl: true, contentKind: true, createdAt: true },
      orderBy: { _count: { contentUrl: 'desc' } },
      take: 50,
    });
    return rows.map((row) => ({
      sourceId: row.sourceId,
      contentUrl: row.contentUrl,
      title: row._max?.title ?? null,
      imageUrl: row._max?.imageUrl ?? null,
      contentKind: row._max?.contentKind ?? null,
      lastLikedAt: row._max?.createdAt ?? null,
      likes: row._count?._all ?? 0,
    }));
  }

  @Get('likes')
  likes(@Query('q') q?: string) {
    return this.prisma.contentLike.findMany({
      where: q
        ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { user: { email: { contains: q, mode: 'insensitive' } } }] }
        : undefined,
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('users')
  users(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('isAdmin') isAdmin?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize = '25',
  ) {
    const where: Prisma.UserWhereInput = {
      ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] } : {}),
      ...(status ? { status: status as UserStatus } : {}),
      ...(isAdmin !== undefined ? { isAdmin: isAdmin === 'true' } : {}),
    };
    const select = {
      id: true,
      email: true,
      displayName: true,
      status: true,
      isAdmin: true,
      createdAt: true,
      _count: { select: { memberships: true, ownedAccounts: true, devices: true } },
    } as const;
    if (!page) {
      return this.prisma.user.findMany({ where, select, orderBy: { createdAt: 'desc' }, take: 200 });
    }
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    return this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip: (current - 1) * size, take: size }),
    ]).then(([total, data]) => ({ data, total, page: current, pageSize: size }));
  }

  @Patch('subscriptions/:id')
  async updateSubscription(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(subscriptionUpdateSchema)) body: { status?: SubscriptionStatus; extendDays?: number; planId?: string },
  ) {
    const current = await this.prisma.subscription.findUniqueOrThrow({ where: { id }, include: { plan: true } });
    const data: {
      status?: SubscriptionStatus;
      planId?: string;
      currentPeriodEnd?: Date;
    } = {};
    if (body.status) data.status = body.status;
    if (body.planId) data.planId = body.planId;
    if (body.extendDays) {
      const base = current.currentPeriodEnd ?? new Date();
      data.currentPeriodEnd = new Date(base.getTime() + body.extendDays * 24 * 60 * 60 * 1000);
    }
    const subscription = await this.prisma.subscription.update({ where: { id }, data, include: { plan: true } });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.sub,
        accountId: subscription.accountId,
        action: 'SUBSCRIPTION_UPDATED',
        targetType: 'Subscription',
        targetId: id,
        metadata: { status: body.status, extendDays: body.extendDays, planId: body.planId },
      },
    });
    this.realtime.emitAccount(subscription.accountId, 'subscription.updated', { subscriptionId: subscription.id });
    return subscription;
  }

  @Get('devices')
  devices(
    @Query('q') q?: string,
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize = '25',
  ) {
    const where: Prisma.DeviceWhereInput = {
      ...(q ? { OR: [{ deviceName: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { model: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] } : {}),
      ...(platform ? { platform: platform as DevicePlatform } : {}),
      ...(status ? { status: status as DeviceStatus } : {}),
    };
    const include = {
      account: { select: { owner: { select: { email: true, displayName: true } } } },
    } as const;
    if (!page) {
      return this.prisma.device.findMany({ where, include, orderBy: { lastSeenAt: 'desc' }, take: 200 });
    }
    const current = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    return this.prisma.$transaction([
      this.prisma.device.count({ where }),
      this.prisma.device.findMany({ where, include, orderBy: { lastSeenAt: 'desc' }, skip: (current - 1) * size, take: size }),
    ]).then(([total, data]) => ({ data, total, page: current, pageSize: size }));
  }

  @Get('payments')
  async paymentsList(
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    const where = {
      ...(status ? { status: status as PaymentStatus } : {}),
      ...(provider ? { provider: provider as PaymentProviderKind } : {}),
      ...(accountId ? { accountId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: { account: { select: { owner: { select: { email: true, displayName: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  @Get('metrics')
  async metrics() {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 29 * 24 * 60 * 60 * 1000);
    const [accounts, subscriptions, openTickets, devices, payments, usageSessions] = await this.prisma.$transaction([
      this.prisma.account.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
      this.prisma.supportTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      this.prisma.device.count(),
      this.prisma.payment.findMany({
        where: { status: 'PAID', createdAt: { gte: fromDate, lte: toDate } },
        select: { amountCents: true, paidAt: true, createdAt: true },
      }),
      this.prisma.usageSession.findMany({
        where: { acquiredAt: { gte: fromDate, lte: toDate } },
        select: { userId: true, acquiredAt: true },
      }),
    ]);
    const byDay = new Map<string, number>();
    let incomeCents = 0;
    let paidCount = 0;
    for (const payment of payments) {
      incomeCents += payment.amountCents;
      paidCount += 1;
      const day = (payment.paidAt ?? payment.createdAt).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + payment.amountCents);
    }
    const revenueDaily: { date: string; incomeCents: number }[] = [];
    for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.toISOString().slice(0, 10);
      revenueDaily.push({ date: day, incomeCents: byDay.get(day) ?? 0 });
    }
    // Concurrent users per day: unique userIds per day
    const usersByDay = new Map<string, Set<string>>();
    for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.toISOString().slice(0, 10);
      usersByDay.set(day, new Set());
    }
    for (const session of usageSessions) {
      const day = session.acquiredAt.toISOString().slice(0, 10);
      usersByDay.get(day)?.add(session.userId);
    }
    const concurrentUsersDaily: { date: string; users: number }[] = [];
    for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.toISOString().slice(0, 10);
      concurrentUsersDaily.push({ date: day, users: usersByDay.get(day)?.size ?? 0 });
    }
    return {
      accounts: Object.fromEntries(accounts.map((row) => [row.status, row._count])),
      subscriptions: Object.fromEntries(subscriptions.map((row) => [row.status, row._count])),
      revenueDaily,
      concurrentUsersDaily,
      incomeCents,
      paidCount,
      openTickets,
      devices,
    };
  }

  @Get('terms')
  terms() {
    return this.prisma.termsVersion.findMany({ orderBy: { version: 'desc' } });
  }

  @Post('terms')
  async createTerms(@Body(new ZodValidationPipe(termsCreateSchema)) body: { title?: string; body: string }) {
    const latest = await this.prisma.termsVersion.findFirst({ orderBy: { version: 'desc' } });
    return this.prisma.termsVersion.create({ data: { title: body.title, body: body.body, version: (latest?.version ?? 0) + 1 } });
  }

  @Patch('terms/:id/publish')
  async publishTerms(@CurrentUser() admin: AuthPrincipal, @Param('id') id: string) {
    await this.prisma.termsVersion.updateMany({ where: { published: true }, data: { published: false } });
    const terms = await this.prisma.termsVersion.update({ where: { id }, data: { published: true, publishedAt: new Date() } });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'TERMS_PUBLISHED', targetType: 'TermsVersion', targetId: id, metadata: { version: terms.version } },
    });
    return terms;
  }

  @Get('promotions')
  promotions() {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post('promotions')
  createPromotion(
    @Body(new ZodValidationPipe(promotionCreateSchema)) body: { code: string; title: string; description?: string; discountPercent: number; maxRedemptions?: number; startsAt?: string; expiresAt?: string },
  ) {
    return this.prisma.promotion.create({
      data: {
        code: body.code,
        title: body.title,
        description: body.description,
        discountPercent: body.discountPercent,
        maxRedemptions: body.maxRedemptions,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      },
    });
  }

  @Patch('promotions/:id')
  updatePromotion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(promotionUpdateSchema)) body: {
      code?: string; title?: string; description?: string | null; discountPercent?: number; maxRedemptions?: number | null; startsAt?: string | null; expiresAt?: string | null; active?: boolean; usedCount?: number;
    },
  ) {
    const { startsAt, expiresAt, ...rest } = body;
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...rest,
        startsAt: startsAt === null ? null : startsAt ? new Date(startsAt) : undefined,
        expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
      },
    });
  }

  @Post('announcements')
  async announce(@CurrentUser() admin: AuthPrincipal, @Body(new ZodValidationPipe(announcementSchema)) body: { message: string }) {
    this.realtime.broadcast('admin.announcement', { message: body.message, at: new Date().toISOString() });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'ANNOUNCEMENT_SENT', targetType: 'Announcement', metadata: { message: body.message } },
    });
    return { ok: true };
  }

  @Get('revenue')
  async revenue(@Query('from') from?: string, @Query('to') to?: string) {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : new Date(toDate.getTime() - 29 * 24 * 60 * 60 * 1000);
    const payments = await this.prisma.payment.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      select: { amountCents: true, currency: true, provider: true, status: true, paidAt: true, createdAt: true },
    });
    const byDate = new Map<string, { incomeCents: number; count: number }>();
    const byProvider = new Map<string, { incomeCents: number; count: number }>();
    const byStatus = new Map<string, { amountCents: number; count: number }>();
    let incomeCents = 0;
    let incomeCount = 0;
    for (const payment of payments) {
      const statusBucket = byStatus.get(payment.status) ?? { amountCents: 0, count: 0 };
      statusBucket.amountCents += payment.amountCents;
      statusBucket.count += 1;
      byStatus.set(payment.status, statusBucket);
      if (payment.status !== 'PAID') continue;
      incomeCents += payment.amountCents;
      incomeCount += 1;
      const day = (payment.paidAt ?? payment.createdAt).toISOString().slice(0, 10);
      const bucket = byDate.get(day) ?? { incomeCents: 0, count: 0 };
      bucket.incomeCents += payment.amountCents;
      bucket.count += 1;
      byDate.set(day, bucket);
      const providerBucket = byProvider.get(payment.provider) ?? { incomeCents: 0, count: 0 };
      providerBucket.incomeCents += payment.amountCents;
      providerBucket.count += 1;
      byProvider.set(payment.provider, providerBucket);
    }
    const daily: { date: string; incomeCents: number; count: number }[] = [];
    for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.toISOString().slice(0, 10);
      daily.push({ date: day, incomeCents: byDate.get(day)?.incomeCents ?? 0, count: byDate.get(day)?.count ?? 0 });
    }
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      totals: { incomeCents, count: incomeCount },
      byStatus: Array.from(byStatus.entries()).map(([status, value]) => ({ status, ...value })),
      daily,
      byProvider: Array.from(byProvider.entries()).map(([provider, value]) => ({ provider, ...value })).sort((a, b) => b.incomeCents - a.incomeCents),
    };
  }

  @Post('purge-blocked-sources')
  @UseGuards(SuperAdminGuard)
  async purgeBlockedSources() {
    const BLOCKED = [
      '1xbet', '1xbet.com', '1xbetname.com', 'bet365', 'betano',
      'sportbet', 'gambling', 'casino', 'poker', 'bingo',
      'betting', 'odds', 'wager', 'stake.com', 'betway',
      'betfair', 'bwin', 'williamhill', 'unibet', 'betsson',
      'pin-up', 'parimatch', 'melbet', 'mostbet', '1win',
      'megapari', 'linebet',
    ];
    const urlConditions = BLOCKED.map((h) => ({ providerUrl: { contains: h } }));
    const count = await this.prisma.streamSource.deleteMany({
      where: { OR: urlConditions },
    });
    return { deleted: count.count };
  }
}
