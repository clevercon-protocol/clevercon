import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Events a webhook can subscribe to. Buyer-side: task.completed/failed and
 * dispute.resolved. Provider-side: job.paid (a settlement paid you) and
 * dispute.opened (a job you fulfilled was disputed). Delivered as they happen.
 */
export const WEBHOOK_EVENTS = [
  'task.completed',
  'task.failed',
  'job.paid',
  'dispute.opened',
  'dispute.resolved',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_TIMEOUT_MS = 8000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliver an event to a user's registered webhooks (best-effort). Mirrors the
   * worker's deliverWebhooks: a POST with an `x-clevercon-signature` =
   * HMAC-SHA256(body) keyed by the webhook secret. Used for API-originated events
   * (e.g. dispute.opened / dispute.resolved) that the worker never sees. Failures
   * are logged and swallowed so a webhook hiccup never affects the request.
   */
  async deliver(
    userId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let hooks;
    try {
      hooks = await this.prisma.webhook.findMany({ where: { userId, active: true } });
    } catch {
      return;
    }
    const targets = hooks.filter((h) => h.events.length === 0 || h.events.includes(event));
    if (targets.length === 0) return;
    const body = JSON.stringify({ event, data: payload, at: new Date().toISOString() });
    await Promise.all(
      targets.map(async (h) => {
        try {
          const signature = createHmac('sha256', h.secret).update(body).digest('hex');
          const res = await fetch(h.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-clevercon-event': event,
              'x-clevercon-signature': signature,
            },
            body,
            signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          });
          if (!res.ok) this.logger.warn(`webhook ${h.url} -> ${res.status} for ${event}`);
        } catch (err) {
          this.logger.warn(`webhook ${h.url} failed for ${event}: ${(err as Error).message}`);
        }
      }),
    );
  }

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
