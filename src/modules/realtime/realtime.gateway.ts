import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../common/database/prisma.service';
import type { AuthPrincipal } from '../../common/security/current-user.decorator';

@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    credentials: true,
    origin: (origin, callback) => {
      const originsStr = process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001';
      const allowed = String(originsStr).split(',').filter(Boolean);
      callback(null, !origin || allowed.includes(origin));
    },
  },
})
export class RealtimeGateway {
  @WebSocketServer() server!: Server;
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    try {
      const raw = String(socket.handshake.auth?.token ?? socket.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!raw) return socket.disconnect(true);
      const principal = await this.jwt.verifyAsync<AuthPrincipal>(raw, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });
      const session = await this.prisma.session.findUnique({ where: { id: principal.sessionId }, include: { user: { select: { status: true, isAdmin: true } } } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return socket.disconnect(true);
      socket.data.principal = principal;
      await socket.join(`user:${principal.sub}`);
      if (session.user.isAdmin) await socket.join('admin');
      const requestedDeviceId = String(socket.handshake.auth?.deviceId ?? principal.deviceId ?? '');
      if (requestedDeviceId) {
        const device = await this.prisma.device.findFirst({ where: { id: requestedDeviceId, userId: principal.sub, status: 'ACTIVE' } });
        if (device) await socket.join(`device:${device.id}`);
      }
      const membership = await this.prisma.accountMember.findFirst({ where: { userId: principal.sub, status: 'ACTIVE' } });
      if (membership) await socket.join(`account:${membership.accountId}`);
    } catch {
      socket.disconnect(true);
    }
  }

  emitUser(userId: string, event: string, payload: unknown) { this.server.to(`user:${userId}`).emit(event, payload); }
  emitDevice(deviceId: string, event: string, payload: unknown) { this.server.to(`device:${deviceId}`).emit(event, payload); }
  emitAccount(accountId: string, event: string, payload: unknown) { this.server.to(`account:${accountId}`).emit(event, payload); }
  emitAdmin(event: string, payload: unknown) { this.server.to('admin').emit(event, payload); }
  broadcast(event: string, payload: unknown) { this.server.emit(event, payload); }
}
