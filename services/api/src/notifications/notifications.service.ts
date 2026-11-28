import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { recordNotification, type NotificationInput } from '@clevercon/db';
import type { AppEnv } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsGateway } from '../events/events.gateway.js';
import { MailerService } from '../mail/mailer.service.js';
import { notificationEmail } from '../mail/templates.js';

/** The notification event catalog: what a user can tune in their preferences. */
export const EVENT_TYPES: { type: string; label: string }[] = [
  { type: 'task.completed', label: 'Your hire is complete' },
  { type: 'task.failed', label: 'A hire failed' },
  { type: 'job.paid', label: 'You got paid (provider)' },
  { type: 'review.received', label: 'A new review (provider)' },
  { type: 'review.responded', label: 'A provider replied to your review' },
  { type: 'dispute.opened', label: 'A dispute was opened' },
  { type: 'dispute.resolved', label: 'A dispute was resolved' },
];

/** Events that default to ALSO emailing (high-signal) when a verified email exists. */
const EMAIL_DEFAULT_ON = new Set([
  'job.paid',
  'task.completed',
  'dispute.opened',
  'dispute.resolved',
  'review.received',
]);

/**
 * In-app notification feed (P4). Wraps the shared recordNotification writer with a
 * real-time nudge (socket `notification` event, so the bell updates live), optional
 * email delivery (Resend, when configured + the user opted in), and the read/list/count
 * operations the feed UI needs. API-originated events (reviews, disputes) create
 * notifications through here; the worker uses recordNotification directly (it has its own
 * socket emitter). Writes are best-effort and never throw.
 */
@Injectable()
export class NotificationsService {
  private readonly appUrl?: string;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsGateway,
    @Optional() private readonly mailer?: MailerService,
    @Optional() config?: ConfigService<AppEnv, true>,
  ) {
    this.appUrl = config?.get('APP_PUBLIC_URL', { infer: true });
  }

  /** Create a feed notification, nudge the socket, and email it if the user opted in. */
  async create(input: NotificationInput): Promise<void> {
    const row = await recordNotification(this.prisma, input);
    if (row) {
      this.events?.emitToUser(input.userId, 'notification', {
        id: row.id,
        type: input.type,
        title: input.title,
      });
      await this.maybeEmail(input);
    }
  }

  /** A deep link into the dapp for this notification, if APP_PUBLIC_URL is set. */
  private deepLink(data?: Record<string, unknown> | null): string | null {
    if (!this.appUrl || !data) return null;
    const base = this.appUrl.replace(/\/$/, '');
    if (typeof data.taskId === 'string') return `${base}/app/tasks/${data.taskId}`;
    if (typeof data.serviceId === 'string') return `${base}/app/marketplace/${data.serviceId}`;
    return null;
  }

  /** Email this notification when email is configured, verified, and enabled for the type. */
  private async maybeEmail(input: NotificationInput): Promise<void> {
    if (!this.mailer?.enabled) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, emailVerified: true },
      });
      if (!user?.email || !user.emailVerified) return;
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId: input.userId, type: input.type } },
      });
      const emailOn = pref ? pref.email : EMAIL_DEFAULT_ON.has(input.type);
      if (!emailOn) return;
      const { subject, html, text } = notificationEmail(
        input.title,
        input.body ?? null,
        this.deepLink(input.data),
      );
      await this.mailer.send({ to: user.email, subject, html, text });
    } catch {
      // email is best-effort; never break the notification over a mail error
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

  /** A user's effective per-event email preferences (defaults applied where unset). */
  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    return {
      emailEnabled: this.mailer?.enabled ?? false,
      types: EVENT_TYPES.map((e) => ({
        type: e.type,
        label: e.label,
        email: byType.get(e.type)?.email ?? EMAIL_DEFAULT_ON.has(e.type),
      })),
    };
  }

  /** Set whether a given event emails this user (in-app is always on). */
  async setPreference(userId: string, type: string, email: boolean) {
    if (!EVENT_TYPES.some((e) => e.type === type)) return { ok: false };
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, email, inApp: true },
      update: { email },
    });
    return { ok: true };
  }
}
