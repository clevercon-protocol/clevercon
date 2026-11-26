import { Injectable, Optional } from '@nestjs/common';
import { recordNotification, type NotificationInput } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsGateway } from '../events/events.gateway.js';

/**
 * In-app notification feed (P4). Wraps the shared recordNotification writer with a
 * real-time nudge (socket `notification` event, so the bell updates live) and the
 * read/list/count operations the feed UI needs. API-originated events (reviews,
 * disputes) create notifications through here; the worker uses recordNotification
 * directly (it has its own socket emitter). Writes are best-effort and never throw.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsGateway,
  ) {}

  /** Create a feed notification and nudge the user's socket so the bell updates live. */
  async create(input: NotificationInput): Promise<void> {
    const row = await recordNotification(this.prisma, input);
    if (row) {
      this.events?.emitToUser(input.userId, 'notification', {
        id: row.id,
        type: input.type,
        title: input.title,
      });
    }
  }

  /** Fan one event out to several users (e.g. notify every provider on a task). */
  async createMany(userIds: string[], input: Omit<NotificationInput, 'userId'>): Promise<void> {
    for (const userId of new Set(userIds)) await this.create({ ...input, userId });
  }

  async list(userId: string, limit = 20, offset = 0, unreadOnly = false) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.max(offset, 0);
    const where = { userId, ...(unreadOnly ? { read: false } : {}) };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({ where: { userId, read: false } });
    return { unread };
  }

  /** Mark specific notifications (that belong to the user) read. */
  async markRead(userId: string, ids: string[]): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };
    const res = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { read: true },
    });
    return { updated: res.count };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { updated: res.count };
  }
}
