import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

interface AccessPayload {
  sub: string;
  roles: string[];
}

/**
 * Real-time events. Clients connect with their access token and are joined to a
 * private room `user:<id>`; the worker (and the API) emit task/payment updates to
 * that room. The Redis adapter fans out across API instances, and the worker
 * (a separate process) reaches connected clients via the matching redis-emitter.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set; WebSocket runs single-instance (no Redis adapter)');
      return;
    }
    const pub = new Redis(url, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    server.adapter(createAdapter(pub, sub));
    this.logger.log('WebSocket Redis adapter enabled');
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token);
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  /** Emit an event to a single user's room (used by the API side). */
  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
