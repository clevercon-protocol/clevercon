import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, PaymentStatus, StepStatus, TaskMode, TaskStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import { VaultContractService } from '../vault/vault-contract.service.js';
import { DelegateService } from '../vault/delegate.service.js';
import { PoliciesService, type PolicyRules } from '../policies/policies.service.js';

type TaskRow = Prisma.TaskGetPayload<{
  include: { steps: { select: { id: true; status: true } }; payments: true };
}>;

export interface ListTasksParams {
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

export interface CreateTaskParams {
  title: string;
  mode: TaskMode;
  budget: number;
  serviceId?: string;
  policyId?: string;
  description?: string;
}

export interface PaymentLine {
  payee: string;
  amount: number;
  reason?: string;
}

export interface CreatePaymentParams {
  kind: 'pay' | 'disburse';
  lines: PaymentLine[];
  policyId?: string;
  title?: string;
}

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;

function spentOf(t: TaskRow): number {
  return Number(
    t.payments
      .filter((p) => p.status === PaymentStatus.CONFIRMED)
      .reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0)),
  );
}

function serialize(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    mode: t.mode,
    status: t.status,
    budget: Number(t.budget),
    spent: spentOf(t),
    asset: t.asset,
    stepCount: t.steps.length,
    completedSteps: t.steps.filter((s) => s.status === StepStatus.RELEASED).length,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

@Injectable()
export class TasksService {
  // QueueService is optional so the service can be constructed directly in tests
  // without Redis; in the app, Nest injects it (QueueModule is global).
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly queue?: QueueService,
    @Optional() private readonly vault?: VaultContractService,
    @Optional() private readonly delegates?: DelegateService,
    @Optional() private readonly policies?: PoliciesService,
  ) {}

  /**
   * If the task carries a policy and the buyer has an authorized delegate and
   * funds, lock the budget on-chain under that policy commitment so the delegate
   * can later settle released steps. Best-effort: any failure (no delegate, not
   * registered, insufficient funds, chain error) leaves the task running
   * off-chain rather than failing the hire. Returns the on-chain task id if locked.
   */
  private async lockOnChain(
    userId: string,
    taskId: string,
    policyId: string,
    budget: number,
  ): Promise<void> {
    if (!this.vault?.active || !this.delegates?.available) return;
    const policy = await this.prisma.policy.findFirst({ where: { id: policyId, userId } });
    if (!policy) return;
    const delegate = await this.prisma.agentDelegate.findUnique({ where: { userId } });
    if (!delegate?.registered) return; // delegate must be authorized on-chain first
    try {
      const kp = await this.delegates.keypairFor(userId);
      if (!kp) return;
      const vaultTaskId = await this.vault.createTaskWithPolicy(kp, budget, policy.commitment);
      await this.prisma.task.update({
        where: { id: taskId },
        data: { vaultTaskId, policy: { connect: { id: policyId } } },
      });
      this.logger.log(`Locked task ${taskId} on-chain as vault task ${vaultTaskId}`);
    } catch (err) {
      this.logger.warn(`On-chain lock skipped for task ${taskId}: ${(err as Error).message}`);
    }
  }

  /**
   * Create a task for the current buyer. The task starts in DRAFT; no money
   * moves here. For a DIRECT hire against a known service we seed the single
   * step so its estimated cost is visible; SEARCH/COMPOSE plan their steps
   * later (in the worker layer). Execution and settlement are wired separately.
   */
  async create(userId: string, params: CreateTaskParams) {
    const data: Prisma.TaskCreateInput = {
      buyer: { connect: { id: userId } },
      title: params.title,
      description: params.description,
      mode: params.mode,
      budget: new Prisma.Decimal(params.budget),
      asset: 'USDC',
      status: TaskStatus.DRAFT,
    };

    if (params.mode === TaskMode.DIRECT) {
      if (!params.serviceId) {
        throw new BadRequestException('A direct hire needs a serviceId');
      }
      const service = await this.prisma.service.findUnique({ where: { id: params.serviceId } });
      if (!service) throw new BadRequestException('Unknown service');
      data.steps = {
        create: [
          {
            index: 0,
            action: `Pay ${service.name}`,
            service: { connect: { id: service.id } },
            estimatedCost: service.pricePerCall,
            status: StepStatus.PENDING,
          },
        ],
      };
    } else if (params.serviceId) {
      // A starting service is optional for search/compose; ignore if absent.
      const service = await this.prisma.service.findUnique({ where: { id: params.serviceId } });
      if (!service) throw new BadRequestException('Unknown service');
    }

    const created = await this.prisma.task.create({
      data,
      include: { steps: { select: { id: true, status: true } }, payments: true },
    });
    // If a policy is attached, lock the budget on-chain under it before running,
    // so released steps can settle to providers via the delegate. Best-effort.
    if (params.policyId) {
      await this.lockOnChain(userId, created.id, params.policyId, params.budget);
    }
    // A task with steps (a DIRECT hire) is ready to run now; hand it to the
    // worker queue. SEARCH/COMPOSE have no steps yet (planning is a later job).
    if (created.steps.length > 0) await this.queue?.enqueueTaskExecution(created.id);
    return serialize(created);
  }

  /**
   * The core spend primitive: pay one address (kind='pay') or disburse to many
   * (kind='disburse'), each line bounded by a policy and released directly from
   * the vault via the proof-gated path. Reuses the same lock-under-policy and
   * settlement machinery as a hire, minus the provider-execution step.
   *
   * Every payment is bounded: a chosen limit, or one derived from the lines
   * themselves (allowlist = these payees, cap = the largest line). The task
   * budget (sum of lines) is enforced on-chain; the caps/allowlist are enforced
   * here in v1 and recorded as a private commitment (full on-chain rule
   * enforcement is the ZK circuit, a later milestone).
   */
  async createPayment(userId: string, params: CreatePaymentParams) {
    const lines = params.lines
      .map((l) => ({
        payee: l.payee.trim(),
        amount: Number(l.amount),
        reason: l.reason?.trim() || undefined,
      }))
      .filter((l) => l.payee && Number.isFinite(l.amount) && l.amount > 0);
    if (lines.length === 0) {
      throw new BadRequestException('At least one valid payment line is required');
    }
    if (params.kind === 'pay' && lines.length !== 1) {
      throw new BadRequestException('A single payment has exactly one line');
    }
    for (const l of lines) {
      if (!STELLAR_ADDR.test(l.payee)) {
        throw new BadRequestException(`Invalid payee address: ${l.payee}`);
      }
    }
    const total = lines.reduce((s, l) => s + l.amount, 0);

    // Resolve the bounding policy: a chosen limit, or a tight one derived from
    // the lines (allowlist = these payees, cap = the largest single line).
    let policyId = params.policyId;
    let rules: PolicyRules | null = null;
    if (policyId) {
      const p = await this.prisma.policy.findFirst({ where: { id: policyId, userId } });
      if (!p) throw new BadRequestException('Unknown policy');
      rules = (p.ruleSummary as PolicyRules | null) ?? null; // null for private
    } else {
      if (!this.policies) throw new BadRequestException('A policy is required for payments');
      const derived: PolicyRules = {
        allowlist: [...new Set(lines.map((l) => l.payee))],
        perPaymentCeilingUsdc: Math.max(...lines.map((l) => l.amount)),
      };
      const created = await this.policies.create(userId, { rules: derived, isPrivate: false });
      policyId = created.id;
      rules = derived;
    }

    // Enforce known rules off-chain (v1). Where the rule is private (rules null)
    // the owner is responsible; the on-chain budget still bounds the total.
    if (rules) {
      for (const l of lines) {
        if (rules.perPaymentCeilingUsdc != null && l.amount > rules.perPaymentCeilingUsdc) {
          throw new BadRequestException(
            `Line to ${l.payee} exceeds the per-payment cap of ${rules.perPaymentCeilingUsdc}`,
          );
        }
        if (rules.allowlist?.length && !rules.allowlist.includes(l.payee)) {
          throw new BadRequestException(`Payee ${l.payee} is not on the policy allowlist`);
        }
      }
    }

    const mode = params.kind === 'pay' ? TaskMode.PAY : TaskMode.DISBURSE;
    const title =
      params.title ??
      (params.kind === 'pay'
        ? `Pay ${lines[0].payee.slice(0, 6)}…${lines[0].payee.slice(-4)}`
        : `Disburse to ${lines.length} recipients`);

    const created = await this.prisma.task.create({
      data: {
        buyer: { connect: { id: userId } },
        title,
        mode,
        budget: new Prisma.Decimal(total),
        asset: 'USDC',
        // No provider execution: the steps are authorized to pay immediately and
        // settle out of band via the delegate. The task completes once finalized.
        status: TaskStatus.RUNNING,
        steps: {
          create: lines.map((l, i) => ({
            index: i,
            action: l.reason ?? 'Payment',
            payee: l.payee,
            estimatedCost: new Prisma.Decimal(l.amount),
            status: StepStatus.RELEASED,
          })),
        },
      },
      include: { steps: { select: { id: true, status: true } }, payments: true },
    });

    // Lock the total on-chain under the policy commitment (required for the
    // proof-gated release). If it cannot bind, fail loudly rather than dangle.
    await this.lockOnChain(userId, created.id, policyId, total);
    const bound = await this.prisma.task.findUnique({
      where: { id: created.id },
      select: { vaultTaskId: true },
    });
    if (!bound?.vaultTaskId) {
      await this.prisma.task.update({
        where: { id: created.id },
        data: { status: TaskStatus.FAILED },
      });
      throw new BadRequestException(
        'Could not lock the payment on-chain. Enable Autopay and make sure the vault has enough available balance.',
      );
    }

    // Enqueue a direct release per line; settlement pays each payee and finalizes.
    for (const s of created.steps) await this.queue?.enqueueSettlement(s.id);
    return serialize(created);
  }

  /**
   * Raise a dispute on one of the caller's tasks. One open dispute per task;
   * records the buyer's wallet as the raiser. Operators resolve it from the
   * admin console.
   */
  async raiseDispute(userId: string, taskId: string, reason?: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, buyerId: userId } });
    if (!task) throw new NotFoundException('Task not found');
    const open = await this.prisma.dispute.findFirst({
      where: { taskId, status: 'OPEN' },
    });
    if (open) throw new BadRequestException('This task already has an open dispute');
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId },
      orderBy: { isPrimary: 'desc' },
      select: { address: true },
    });
    const d = await this.prisma.dispute.create({
      data: {
        taskId,
        raisedBy: wallet?.address ?? userId,
        reason: reason ?? null,
        status: 'OPEN',
      },
    });
    return { id: d.id, status: d.status, createdAt: d.createdAt };
  }

  /** The current user's tasks, newest first. */
  async listForUser(userId: string, params: ListTasksParams) {
    const where: Prisma.TaskWhereInput = { buyerId: userId };
    if (params.status) where.status = params.status;

    const take = Math.min(params.limit ?? 50, 100);
    const skip = params.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: { steps: { select: { id: true, status: true } }, payments: true },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items: rows.map(serialize), total, limit: take, offset: skip };
  }

  /** Full detail for one task: summary plus its steps and payment receipts. */
  async getForUser(userId: string, id: string) {
    const t = await this.prisma.task.findFirst({
      where: { id, buyerId: userId },
      include: {
        steps: { orderBy: { index: 'asc' }, include: { service: { select: { name: true } } } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!t) throw new NotFoundException('Task not found');
    const spent = Number(
      t.payments
        .filter((p) => p.status === PaymentStatus.CONFIRMED)
        .reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0)),
    );
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      mode: t.mode,
      status: t.status,
      budget: Number(t.budget),
      spent,
      asset: t.asset,
      stepCount: t.steps.length,
      completedSteps: t.steps.filter((s) => s.status === StepStatus.RELEASED).length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      steps: t.steps.map((s) => ({
        index: s.index,
        action: s.action,
        status: s.status,
        estimatedCost: Number(s.estimatedCost),
        service: s.service?.name ?? null,
        latencyMs: s.latencyMs,
        error: s.error,
        // The provider's returned result for this step, so the buyer sees what
        // they paid for (truncated to 2000 chars at execution time).
        output: s.output,
      })),
      receipts: t.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        asset: p.asset,
        status: p.status,
        method: p.method,
        toAddress: p.toAddress,
        txHash: p.txHash,
        createdAt: p.createdAt,
      })),
    };
  }
}
