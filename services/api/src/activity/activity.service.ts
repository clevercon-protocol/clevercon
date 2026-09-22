import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

export type ActivityKind =
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'payment';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  amount?: number;
  asset?: string;
  status?: string;
  txHash?: string | null;
  taskId?: string;
  at: string; // ISO timestamp
}

const TERMINAL_KIND: Partial<Record<TaskStatus, ActivityKind>> = {
  [TaskStatus.COMPLETED]: 'task_completed',
  [TaskStatus.FAILED]: 'task_failed',
  [TaskStatus.CANCELLED]: 'task_cancelled',
};

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A buyer-scoped activity timeline: job lifecycle (created, and its terminal
   * outcome) plus payment events, merged and sorted newest-first. On-chain money
   * movements surface here once payments are recorded; until then it reflects job
   * activity, which is honest rather than fabricated.
   */
  async forUser(userId: string, limit = 50): Promise<ActivityItem[]> {
    const [tasks, payments] = await Promise.all([
      this.prisma.task.findMany({
        where: { buyerId: userId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          budget: true,
          asset: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { task: { buyerId: userId } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          amount: true,
          asset: true,
          status: true,
          txHash: true,
          taskId: true,
          createdAt: true,
          task: { select: { title: true } },
        },
      }),
    ]);

    const items: ActivityItem[] = [];
    for (const t of tasks) {
      items.push({
        id: `task-created-${t.id}`,
        kind: 'task_created',
        title: `Job created: ${t.title}`,
        amount: Number(t.budget),
        asset: t.asset,
        taskId: t.id,
        at: t.createdAt.toISOString(),
      });
      const kind = TERMINAL_KIND[t.status];
      // Only emit an outcome event if the task actually reached a terminal state
      // (updatedAt differs from createdAt), so a fresh DRAFT does not double-log.
      if (kind && t.updatedAt.getTime() !== t.createdAt.getTime()) {
        items.push({
          id: `task-${t.status}-${t.id}`,
          kind,
          title: `Job ${t.status.toLowerCase()}: ${t.title}`,
          status: t.status,
          taskId: t.id,
          at: t.updatedAt.toISOString(),
        });
      }
    }
    for (const p of payments) {
      items.push({
        id: `payment-${p.id}`,
        kind: 'payment',
        title: `Payment ${p.status.toLowerCase()}`,
        detail: p.task?.title,
        amount: Number(p.amount),
        asset: p.asset,
        status: p.status,
        txHash: p.txHash,
        taskId: p.taskId ?? undefined,
        at: p.createdAt.toISOString(),
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    return items.slice(0, limit);
  }
}
