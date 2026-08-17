import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DevicePlatform, DeviceStatus, PaymentProviderKind, PaymentStatus, SubscriptionStatus, UserStatus } from '@prisma/client';
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
import { AdminGuard } from './admin.guard';
import { accountStatusSchema, adminCreateUserSchema, adminDeviceLinkSchema, adminInviteSchema, adminNotifySchema, adminSetRoleSchema, adminTicketMessageSchema, announcementSchema, manualPaymentSchema, paymentStatusSchema, promotionCreateSchema, promotionUpdateSchema, subscriptionUpdateSchema, termsCreateSchema, ticketStatusSchema } from './admin.schemas';

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
  accounts(@Query('q') q?: string) {
    return this.prisma.account.findMany({
      where: q ? { OR: [{ owner: { email: { contains: q, mode: 'insensitive' } } }, { id: { contains: q } }] } : undefined,
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { members: true, devices: true } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
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

  @Post('users')
  async createUser(
    @CurrentUser() admin: AuthPrincipal,
    @Body(new ZodValidationPipe(adminCreateUserSchema)) body: { email: string; password: string; displayName?: string; isAdmin: boolean },
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
      },
      select: { id: true, email: true, displayName: true, status: true, isAdmin: true, createdAt: true },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'ADMIN_USER_CREATED', targetType: 'User', targetId: user.id, metadata: { email: user.email, isAdmin: user.isAdmin } },
    });
    return user;
  }

  @Patch('users/:id/role')
  async setRole(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminSetRoleSchema)) body: { isAdmin: boolean },
  ) {
    const user = await this.prisma.user.update({ where: { id }, data: { isAdmin: body.isAdmin }, select: { id: true, email: true, displayName: true, status: true, isAdmin: true } });
    await this.prisma.auditLog.create({
      data: { actorUserId: admin.sub, action: 'USER_ROLE_CHANGED', targetType: 'User', targetId: id, metadata: { isAdmin: body.isAdmin } },
    });
    return user;
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
  async supportStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ticketStatusSchema)) body: { status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED' },
  ) {
    const ticket = await this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
    this.realtime.emitAdmin('admin.support.ticket.updated', { id: ticket.id, status: ticket.status });
    return ticket;
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
    this.realtime.emitAdmin('admin.support.message', {
      id: message.id,
      ticketId: id,
      senderRole: 'ADMIN',
      message: message.message,
      createdAt: message.createdAt,
    });
    return message;
  }

  @Get('users/:id')
  async userDetail(@Param('id') id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, displayName: true, status: true, isAdmin: true, createdAt: true },
    });
    const [memberships, ownedAccounts, devices, invitationsSent, invitationsFor, likes] = await this.prisma.$transaction([
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
      this.prisma.device.findMany({ where: { userId: id }, orderBy: { lastSeenAt: 'desc' }, take: 50 }),
      this.prisma.invitation.findMany({ where: { createdById: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.invitation.findMany({ where: { email: user.email }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.contentLike.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
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
    return { ...user, memberships, ownedAccounts, devices, payments, invitationsSent, invitationsFor, likes };
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
  users(@Query('q') q?: string, @Query('status') status?: string) {
    return this.prisma.user.findMany({
      where: {
        ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] } : {}),
        ...(status ? { status: status as UserStatus } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        isAdmin: true,
        createdAt: true,
        _count: { select: { memberships: true, ownedAccounts: true, devices: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
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
  devices(@Query('q') q?: string, @Query('platform') platform?: string, @Query('status') status?: string) {
    return this.prisma.device.findMany({
      where: {
        ...(q ? { OR: [{ deviceName: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { model: { contains: q, mode: 'insensitive' } }, { id: { contains: q } }] } : {}),
        ...(platform ? { platform: platform as DevicePlatform } : {}),
        ...(status ? { status: status as DeviceStatus } : {}),
      },
      include: {
        account: { select: { owner: { select: { email: true, displayName: true } } } },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
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
}
