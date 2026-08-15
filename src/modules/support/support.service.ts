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
        messages: { create: { senderId: userId, senderRole: 'USER', message: input.message } },
      },
      include: { messages: true },
    });
    this.realtime.emitAccount(membership.accountId, 'support.ticket.created', { ticketId: ticket.id });
    return ticket;
  }

  list(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async message(userId: string, ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findFirstOrThrow({ where: { id: ticketId, userId } });
    const created = await this.prisma.supportMessage.create({
      data: { ticketId: ticket.id, senderId: userId, senderRole: 'USER', message },
    });
    this.realtime.emitAccount(ticket.accountId, 'support.message', { ticketId, messageId: created.id });
    return created;
  }
}
