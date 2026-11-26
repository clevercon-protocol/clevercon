import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PaymentStatus, TaskStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsGateway } from '../events/events.gateway.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Buyer reviews of a service, tied to a SETTLED hire (P3). Sybil-resistant: a review
 * can be created only by the task's buyer, only for a service the hire actually used,
 * only once the provider was paid, and only once per hire (unique taskId). The provider
 * may post a single response; either party can flag the other's content for the operator.
 * Ratings fold into the service's denormalized avgRating + reviewCount (trust surfacing).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsGateway,
    @Optional() private readonly webhooks?: WebhooksService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Recompute a service's avg rating + count from its non-flagged reviews. */
  private async recomputeReputation(serviceId: string): Promise<void> {
    const agg = await this.prisma.review.aggregate({
      where: { serviceId, flagged: false },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const avgRating = Math.round((agg._avg.rating ?? 0) * 100) / 100;
    const reviewCount = agg._count._all;
    await this.prisma.serviceReputation.upsert({
      where: { serviceId },
      create: { serviceId, avgRating, reviewCount },
      update: { avgRating, reviewCount },
    });
  }

  /** The provider (user) ids who can respond for / flag on a service (owner + org admins). */
  private async providerIdsForService(serviceId: string): Promise<string[]> {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { providerId: true, ownerOrg: { select: { members: { select: { userId: true } } } } },
    });
    if (!service) return [];
    const ids = new Set<string>();
    if (service.providerId) ids.add(service.providerId);
    for (const m of service.ownerOrg?.members ?? []) ids.add(m.userId);
    return [...ids];
  }

  private async notify(
    userIds: string[],
    event: Parameters<WebhooksService['deliver']>[1],
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (const uid of new Set(userIds)) {
      this.events?.emitToUser(uid, event, payload);
      await this.webhooks?.deliver(uid, event, payload);
    }
  }

  /**
   * Create a review for a settled hire. Validates ownership + settlement + one-per-hire,
   * then recomputes the service's rating and notifies the provider.
   */
  async create(
    userId: string,
    params: { serviceId: string; taskId: string; rating: number; text?: string },
  ) {
    const { serviceId, taskId, rating } = params;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        buyerId: true,
        status: true,
        steps: { select: { id: true, serviceId: true } },
        payments: { select: { stepId: true, status: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.buyerId !== userId) throw new ForbiddenException('not your hire');

    const serviceStepIds = new Set(
      task.steps.filter((s) => s.serviceId === serviceId).map((s) => s.id),
    );
    if (serviceStepIds.size === 0) {
      throw new BadRequestException('this hire did not use that service');
    }
    // Settled = the provider was actually paid: a CONFIRMED release named a step of this
    // service, or (for metered/x402 with no step link) the task has a confirmed payment
    // and completed. This is the anti-Sybil gate - a real transaction must have occurred.
    const paidForService = task.payments.some(
      (p) => p.status === PaymentStatus.CONFIRMED && p.stepId && serviceStepIds.has(p.stepId),
    );
    const anyConfirmed = task.payments.some((p) => p.status === PaymentStatus.CONFIRMED);
    const settled = paidForService || (anyConfirmed && task.status === TaskStatus.COMPLETED);
    if (!settled) {
      throw new BadRequestException(
        'You can review after the hire is settled (the provider has been paid).',
      );
    }
    const existing = await this.prisma.review.findUnique({ where: { taskId } });
    if (existing) throw new BadRequestException('You already reviewed this hire.');

    const review = await this.prisma.review.create({
      data: {
        serviceId,
        taskId,
        authorId: userId,
        rating,
        text: params.text?.trim() ? params.text.trim() : null,
      },
      include: { author: { select: { displayName: true, handle: true } } },
    });
    await this.recomputeReputation(serviceId);
    const providerIds = await this.providerIdsForService(serviceId);
    await this.notify(providerIds, 'review.received', {
      reviewId: review.id,
      serviceId,
      taskId,
      rating,
    });
    await this.notifications?.createMany(providerIds, {
      type: 'review.received',
      title: `New ${rating}-star review`,
      body: params.text?.trim()
        ? params.text.trim().slice(0, 140)
        : 'A buyer reviewed your service.',
      data: { serviceId, reviewId: review.id, taskId },
    });
    return serialize(review, true);
  }

  /** Public list of a service's (non-flagged) reviews, newest first, paginated. */
  async listForService(serviceId: string, limit = 20, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.max(offset, 0);
    const [rows, total, agg] = await Promise.all([
      this.prisma.review.findMany({
        where: { serviceId, flagged: false },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { author: { select: { displayName: true, handle: true } } },
      }),
      this.prisma.review.count({ where: { serviceId, flagged: false } }),
      this.prisma.review.aggregate({
        where: { serviceId, flagged: false },
        _avg: { rating: true },
      }),
    ]);
    return {
      items: rows.map((r) => serialize(r, false)),
      total,
      avgRating: Math.round((agg._avg.rating ?? 0) * 100) / 100,
    };
  }

  /** The buyer's own review for a given hire (so the dapp knows whether to prompt). */
  async mineForTask(userId: string, taskId: string, serviceId: string) {
    const review = await this.prisma.review.findUnique({
      where: { taskId },
      include: { author: { select: { displayName: true, handle: true } } },
    });
    if (!review || review.serviceId !== serviceId) return { review: null };
    if (review.authorId !== userId) return { review: null };
    return { review: serialize(review, true) };
  }

  /** The provider posts a single response to a review of their service. */
  async respond(userId: string, id: string, response: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    const providerIds = await this.providerIdsForService(review.serviceId);
    if (!providerIds.includes(userId)) throw new ForbiddenException('not your service');
    const updated = await this.prisma.review.update({
      where: { id },
      data: { response: response.trim(), respondedAt: new Date() },
      include: { author: { select: { displayName: true, handle: true } } },
    });
    await this.notify([review.authorId], 'review.responded', {
      reviewId: id,
      serviceId: review.serviceId,
    });
    await this.notifications?.create({
      userId: review.authorId,
      type: 'review.responded',
      title: 'The provider responded to your review',
      body: response.trim().slice(0, 140),
      data: { serviceId: review.serviceId, reviewId: id },
    });
    return serialize(updated, false);
  }

  /**
   * Flag a review (or its response) as abusive for the operator. Either the review's
   * author or the service's provider may flag - the two parties to the hire - so random
   * users cannot hide content. A flagged review drops out of the public list + rating.
   */
  async flag(userId: string, id: string, reason?: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    const providerIds = await this.providerIdsForService(review.serviceId);
    const allowed = review.authorId === userId || providerIds.includes(userId);
    if (!allowed) throw new ForbiddenException('not a party to this review');
    await this.prisma.review.update({
      where: { id },
      data: { flagged: true, flagReason: reason?.slice(0, 500) ?? null },
    });
    await this.recomputeReputation(review.serviceId);
    return { ok: true };
  }
}

type ReviewRow = {
  id: string;
  serviceId: string;
  taskId: string;
  authorId: string;
  rating: number;
  text: string | null;
  response: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  author?: { displayName: string | null; handle: string | null } | null;
};

/** Public review shape. `author` is a display name (never the wallet). */
function serialize(r: ReviewRow, isAuthor: boolean) {
  return {
    id: r.id,
    serviceId: r.serviceId,
    // The hire is only exposed to its own author (so they can find/edit it), not publicly.
    taskId: isAuthor ? r.taskId : undefined,
    rating: r.rating,
    text: r.text,
    response: r.response,
    respondedAt: r.respondedAt?.toISOString() ?? null,
    author: r.author?.displayName || r.author?.handle || 'A verified buyer',
    createdAt: r.createdAt.toISOString(),
  };
}
