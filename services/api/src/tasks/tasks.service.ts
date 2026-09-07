import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus, StepStatus, TaskStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

type TaskRow = Prisma.TaskGetPayload<{
  include: { steps: { select: { id: true; status: true } }; payments: true };
}>;

export interface ListTasksParams {
  status?: TaskStatus;
  limit?: number;
  offset?: number;
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
  constructor(private readonly prisma: PrismaService) {}

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

  async getForUser(userId: string, id: string) {
    const t = await this.prisma.task.findFirst({
      where: { id, buyerId: userId },
      include: { steps: { select: { id: true, status: true } }, payments: true },
    });
    if (!t) throw new NotFoundException('Task not found');
    return serialize(t);
  }
}
