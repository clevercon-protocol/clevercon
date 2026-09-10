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
