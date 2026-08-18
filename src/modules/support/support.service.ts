import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { AccountAccessService } from '../accounts/account-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateTicketInput } from './support.schemas';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(userId: string, input: CreateTicketInput) {
    const membership = await this.access.activeMembership(userId);
    const ticket = await this.prisma.supportTicket.create({
      data: {
        accountId: membership.accountId,
        userId,
        deviceId: input.deviceId,
        subject: input.subject,
        category: input.category,
        messages: {
          create: {
            senderId: userId,
            senderRole: 'USER',
            message: input.message,
            attachments: input.attachments ?? [],
          },
        },
      },
      include: { messages: true },
    });
    this.realtime.emitAccount(membership.accountId, 'support.ticket.created', { ticketId: ticket.id, ticket });
    this.realtime.emitAdmin('admin.support.ticket.created', {
      id: ticket.id,
      accountId: ticket.accountId,
      userId: ticket.userId,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      createdAt: ticket.createdAt,
    });
    return ticket;
  }

  list(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async message(userId: string, ticketId: string, message: string, attachments?: string[]) {
    const ticket = await this.prisma.supportTicket.findFirstOrThrow({ where: { id: ticketId, userId } });
    const created = await this.prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: userId,
        senderRole: 'USER',
        message,
        attachments: attachments ?? [],
      },
    });
    const payload = {
      id: created.id,
      ticketId: ticket.id,
      senderRole: 'USER',
      message: created.message,
      attachments: created.attachments,
      createdAt: created.createdAt,
    };
    this.realtime.emitAccount(ticket.accountId, 'support.message', payload);
    this.realtime.emitAdmin('admin.support.message', payload);
    return created;
  }
}
