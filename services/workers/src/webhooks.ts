import { createHmac } from 'node:crypto';
import { type PrismaClient } from '@clevercon/db';
import { logger } from './logger.js';

const DELIVERY_TIMEOUT_MS = 8000;

/**
 * Deliver an event to a user's registered webhooks (best-effort). Each delivery
 * is a POST with the JSON payload and an `x-clevercon-signature` header =
 * HMAC-SHA256(body) keyed by the webhook secret, so the receiver can verify it
 * came from us. A webhook subscribes to specific events, or to all if its events
 * list is empty. Failures are logged and swallowed; they never affect the job.
 */
export async function deliverWebhooks(
  prisma: PrismaClient,
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let hooks;
  try {
    hooks = await prisma.webhook.findMany({ where: { userId, active: true } });
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
        if (!res.ok) logger.warn({ url: h.url, status: res.status, event }, 'webhook non-2xx');
      } catch (err) {
        logger.warn({ url: h.url, event, err: (err as Error).message }, 'webhook delivery failed');
      }
    }),
  );
}
