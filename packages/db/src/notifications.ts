/**
 * Shared in-app notification writer (P4). Both the API (reviews, disputes) and the
 * worker (job delivered/paid/failed) create feed notifications through this one helper,
 * so the feed is consistent regardless of which process raised the event. It only writes
 * the row; real-time nudges (socket `notification` event) and email are layered on top by
 * the caller that has those transports. Best-effort: a write failure never breaks the
 * originating action, it just means the user sees the event when they next poll the feed.
 */
import type { PrismaClient } from '@prisma/client';

export interface NotificationInput {
  userId: string;
  /** Event key, e.g. `job.paid`, `dispute.opened`, `review.received`. */
  type: string;
  title: string;
  body?: string | null;
  /** Deep-link ids for the UI: { taskId?, serviceId?, disputeId?, reviewId?, amount? }. */
  data?: Record<string, unknown> | null;
}

type Delegate = Pick<PrismaClient['notification'], 'create'>;

/** Persist one notification. Returns the row, or null on failure (never throws). */
export async function recordNotification(
  prisma: { notification: Delegate },
  input: NotificationInput,
): Promise<{ id: string } | null> {
  try {
    return await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: (input.data ?? undefined) as never,
      },
      select: { id: true },
    });
  } catch {
    return null;
  }
}
