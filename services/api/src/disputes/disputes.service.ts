import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DisputeStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultContractService } from '../vault/vault-contract.service.js';
import { EventsGateway } from '../events/events.gateway.js';
import { WebhooksService, type WebhookEvent } from '../webhooks/webhooks.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Buyer-facing disputes. Opening a dispute records it and returns the unsigned
 * `raise_dispute` XDR for the buyer to sign (via the existing vault submit path):
 * on-chain this freezes the task so no further release or completion can happen
 * until the dispute resolver settles it (the vault's resolve_dispute splits the
 * still-locked plan_cost - spent). The lock IS the escrow, so nothing is clawed
 * back. See .local/MARKETPLACE-ECONOMY-SPEC.md section 6.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contract: VaultContractService,
    @Optional() private readonly events?: EventsGateway,
    @Optional() private readonly webhooks?: WebhooksService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** The distinct provider (service owner) ids on a task's steps. */
  private async providerIdsForTask(taskId: string): Promise<string[]> {
    const steps = await this.prisma.taskStep.findMany({
      where: { taskId },
      select: { service: { select: { providerId: true } } },
    });
    return [...new Set(steps.map((s) => s.service?.providerId).filter((x): x is string => !!x))];
  }

  /** Notify a set of users on both channels (real-time socket + webhook). */
  private async notify(
    userIds: string[],
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (const uid of new Set(userIds)) {
      this.events?.emitToUser(uid, event, payload);
      await this.webhooks?.deliver(uid, event, payload);
    }
  }

  async open(userId: string, taskId: string, reason?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, buyerId: true, vaultTaskId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.buyerId !== userId) throw new ForbiddenException('not your task');
    if (task.vaultTaskId == null) {
      throw new BadRequestException('task is not locked on-chain; nothing to dispute');
    }
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { address: true },
    });
    if (!wallet) throw new BadRequestException('no wallet on file to sign the dispute');

    const dispute = await this.prisma.dispute.create({
      data: {
        taskId,
        raisedBy: wallet.address,
        reason: reason ?? null,
        status: DisputeStatus.OPEN,
      },
    });
    // Let the provider(s) on this task know a dispute was raised (both channels).
    const providerIds = await this.providerIdsForTask(taskId);
    await this.notify(providerIds, 'dispute.opened', {
      disputeId: dispute.id,
      taskId,
      reason: reason ?? null,
    });
    await this.notifications?.createMany(providerIds, {
      type: 'dispute.opened',
      title: 'A hire you fulfilled was disputed',
      body: reason
        ? reason.slice(0, 140)
        : 'The buyer opened a dispute; funds are frozen pending resolution.',
      data: { disputeId: dispute.id, taskId },
    });
    // The buyer signs this and submits it (POST /vault/submit) to freeze the task.
    const xdr = await this.contract.buildRaiseDisputeXdr(wallet.address, BigInt(task.vaultTaskId));
    return {
      dispute: { id: dispute.id, taskId, status: dispute.status },
      xdr,
      networkPassphrase: this.contract.passphrase,
    };
  }

  async list(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { task: { buyerId: userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { task: { select: { title: true } } },
    });
    return rows.map(serialize);
  }

  /** Disputes on tasks that use one of this provider's services (their inbox). */
  async listForProvider(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { task: { steps: { some: { service: { providerId: userId } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { task: { select: { title: true } } },
    });
    return rows.map(serialize);
  }

  async get(userId: string, id: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: { task: { select: { title: true, buyerId: true } } },
    });
    if (!d || d.task?.buyerId !== userId) throw new NotFoundException('Dispute not found');
    return serialize(d);
  }

  /** A provider on the disputed task posts their reply/evidence (the fairness side). */
  async respond(userId: string, id: string, response: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        task: { include: { steps: { select: { service: { select: { providerId: true } } } } } },
      },
    });
    if (!d) throw new NotFoundException('Dispute not found');
    const owns = d.task?.steps.some((s) => s.service?.providerId === userId) ?? false;
    if (!owns) throw new ForbiddenException('not a provider on this disputed task');
    await this.prisma.dispute.update({ where: { id }, data: { providerResponse: response } });
    return { ok: true };
  }

  /**
   * Arbiter settles a dispute: signs resolve_dispute on-chain (splits the locked
   * remainder; the vault enforces refund + payout == plan_cost - spent), records
   * the outcome, and weighs it into the task's services' reputation (an upheld
   * dispute counts heavier). Admin only.
   */
  async resolve(
    id: string,
    params: {
      refundToUser: number;
      payoutToProvider: number;
      upheld: boolean;
      resolution?: string;
    },
  ) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        task: {
          select: { buyerId: true, vaultTaskId: true, steps: { select: { serviceId: true } } },
        },
      },
    });
    if (!d) throw new NotFoundException('Dispute not found');
    if (d.status !== DisputeStatus.OPEN) throw new BadRequestException('dispute already resolved');
    if (d.task?.vaultTaskId == null) throw new BadRequestException('task has no on-chain id');
    if (params.refundToUser < 0 || params.payoutToProvider < 0) {
      throw new BadRequestException('amounts must be non-negative');
    }

    const txHash = await this.contract.resolveDisputeOnChain(
      BigInt(d.task.vaultTaskId),
      params.refundToUser,
      params.payoutToProvider,
    );
    await this.prisma.dispute.update({
      where: { id },
      data: {
        status: params.upheld ? DisputeStatus.RESOLVED : DisputeStatus.REJECTED,
        resolution: params.resolution ?? null,
        refundToUser: params.refundToUser,
        payoutToProvider: params.payoutToProvider,
        resolvedAt: new Date(),
      },
    });
    const serviceIds = [
      ...new Set(d.task.steps.map((s) => s.serviceId).filter((x): x is string => !!x)),
    ];
    for (const serviceId of serviceIds) {
      await this.prisma.serviceReputation
        .update({
          where: { serviceId },
          data: {
            disputes: { increment: 1 },
            disputesUpheld: { increment: params.upheld ? 1 : 0 },
          },
        })
        .catch(() => {});
    }
    // Notify the buyer and the provider(s) of the outcome (both channels).
    const providerIds = await this.providerIdsForTask(d.taskId);
    await this.notify([d.task.buyerId, ...providerIds], 'dispute.resolved', {
      disputeId: id,
      taskId: d.taskId,
      upheld: params.upheld,
      refundToUser: params.refundToUser,
      payoutToProvider: params.payoutToProvider,
      txHash,
    });
    await this.notifications?.createMany([d.task.buyerId, ...providerIds], {
      type: 'dispute.resolved',
      title: 'A dispute was resolved',
      body: `Refund $${params.refundToUser.toFixed(2)} to buyer, $${params.payoutToProvider.toFixed(2)} to provider.`,
      data: { disputeId: id, taskId: d.taskId },
    });
    return { ok: true, txHash };
  }
}

type DisputeRow = {
  id: string;
  taskId: string;
  status: DisputeStatus;
  reason: string | null;
  resolution: string | null;
  providerResponse: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  task: { title: string } | null;
};

function serialize(d: DisputeRow) {
  return {
    id: d.id,
    taskId: d.taskId,
    task: d.task?.title ?? null,
    status: d.status,
    reason: d.reason,
    resolution: d.resolution,
    providerResponse: d.providerResponse,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
  };
}
