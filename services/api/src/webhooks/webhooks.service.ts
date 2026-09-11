import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

/** Events a webhook can subscribe to. Delivered by the worker as they happen. */
export const WEBHOOK_EVENTS = ['task.completed', 'task.failed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register a webhook. The signing secret is generated server-side and returned
   * ONCE (like an API key); deliveries are HMAC-signed with it so the receiver
   * can verify authenticity. An empty events list means all events.
   */
  async create(userId: string, url: string, events: string[]) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const created = await this.prisma.webhook.create({
      data: { userId, url, events, secret },
    });
    return {
      id: created.id,
      url: created.url,
      events: created.events,
      active: created.active,
      secret,
    };
  }

  /** List the caller's webhooks (secret omitted). */
  async list(userId: string) {
    const rows = await this.prisma.webhook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
    return { items: rows };
  }

  /** Delete one of the caller's webhooks. */
  async remove(userId: string, id: string) {
    const res = await this.prisma.webhook.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException('Webhook not found');
    return { ok: true as const };
  }
}
