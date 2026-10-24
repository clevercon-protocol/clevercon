import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

export type ActivityKind =
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'payment'
  | 'deposit'
  | 'withdraw';

const STROOPS_PER_USDC = 10_000_000;

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

    // Vault money movements (deposit/withdraw) + keyless private payments, from the
    // on-chain event log, so the timeline reflects funding and private spend, not only
    // task spend. Best-effort: a lookup hiccup must never break the rest of the feed.
    try {
      items.push(...(await this.vaultMovements(userId, limit)));
    } catch {
      // ignore
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    return items.slice(0, limit);
  }

  /**
   * The buyer's vault deposits/withdrawals, read from the indexed chain-event log
   * (topics[0] is the account, data.amount is in stroops). We scan a bounded recent
   * window and filter to the user's wallet addresses in memory; at higher volume
   * this should move to a per-address index or a dedicated ledger table.
   */
  private async vaultMovements(userId: string, limit: number): Promise<ActivityItem[]> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { address: true },
    });
    const addresses = new Set(wallets.map((w) => w.address));
    if (addresses.size === 0) return [];

    const events = await this.prisma.chainEvent.findMany({
      where: {
        type: { in: ['deposit_event', 'withdraw_event', 'release_proved_keyless_event'] },
      },
      orderBy: { ledger: 'desc' },
      take: 400,
    });

    const out: ActivityItem[] = [];
    for (const e of events) {
      const p = e.payload as {
        topics?: unknown[];
        data?: { amount?: string; asset?: string } | null;
      } | null;
      // For deposit/withdraw the account is topics[0]; for a keyless release the
      // topics are [user, commitment], so the owner is topics[0] in both cases.
      const account = typeof p?.topics?.[0] === 'string' ? (p.topics[0] as string) : '';
      if (!addresses.has(account)) continue;
      const raw = p?.data?.amount;
      const amount = raw != null ? Number(BigInt(raw)) / STROOPS_PER_USDC : undefined;
      if (e.type === 'release_proved_keyless_event') {
        // A private, keyless spend: one event per payee. The rule stays private, so we
        // only surface the amount + the on-chain tx (the receipt), never the rule.
        out.push({
          id: `chain-${e.id}`,
          kind: 'payment',
          title: 'Private payment sent',
          detail: 'keyless, rule kept private',
          amount,
          asset: 'USDC',
          status: 'SETTLED',
          txHash: e.txHash,
          at: e.createdAt.toISOString(),
        });
      } else {
        const asset = typeof p?.topics?.[1] === 'string' ? (p.topics[1] as string) : undefined;
        const isDeposit = e.type === 'deposit_event';
        out.push({
          id: `chain-${e.id}`,
          kind: isDeposit ? 'deposit' : 'withdraw',
          title: isDeposit ? 'Deposited to vault' : 'Withdrew from vault',
          amount,
          asset,
          txHash: e.txHash,
          at: e.createdAt.toISOString(),
        });
      }
      if (out.length >= limit) break;
    }
    return out;
  }
}
