import { describe, it, expect } from 'vitest';
import { ActivityService } from './activity.service.js';

type TaskRow = {
  id: string;
  title: string;
  status: string;
  budget: number;
  asset: string;
  createdAt: Date;
  updatedAt: Date;
};
type PayRow = {
  id: string;
  amount: number;
  asset: string;
  status: string;
  txHash: string | null;
  taskId: string | null;
  createdAt: Date;
  task: { title: string } | null;
};

function makeService(tasks: TaskRow[], payments: PayRow[]) {
  const prisma = {
    task: { findMany: async () => tasks },
    payment: { findMany: async () => payments },
  };
  return new ActivityService(prisma as unknown as ConstructorParameters<typeof ActivityService>[0]);
}

const t0 = new Date('2026-01-01T00:00:00Z');
const t1 = new Date('2026-01-01T01:00:00Z');
const t2 = new Date('2026-01-01T02:00:00Z');

describe('ActivityService.forUser', () => {
  it('emits only task_created for a fresh task (updatedAt == createdAt)', async () => {
    const svc = makeService(
      [
        {
          id: 'x',
          title: 'Job',
          status: 'DRAFT',
          budget: 5,
          asset: 'USDC',
          createdAt: t0,
          updatedAt: t0,
        },
      ],
      [],
    );
    const items = await svc.forUser('u1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'task_created', amount: 5, asset: 'USDC', taskId: 'x' });
  });

  it('adds a terminal outcome event when the task has been updated', async () => {
    const svc = makeService(
      [
        {
          id: 'x',
          title: 'Job',
          status: 'COMPLETED',
          budget: 5,
          asset: 'USDC',
          createdAt: t0,
          updatedAt: t1,
        },
      ],
      [],
    );
    const items = await svc.forUser('u1');
    expect(items.map((i) => i.kind).sort()).toEqual(['task_completed', 'task_created']);
  });

  it('merges payments and sorts newest-first', async () => {
    const svc = makeService(
      [
        {
          id: 'x',
          title: 'Job',
          status: 'COMPLETED',
          budget: 5,
          asset: 'USDC',
          createdAt: t0,
          updatedAt: t2,
        },
      ],
      [
        {
          id: 'p1',
          amount: 1.5,
          asset: 'USDC',
          status: 'CONFIRMED',
          txHash: 'abc',
          taskId: 'x',
          createdAt: t1,
          task: { title: 'Job' },
        },
      ],
    );
    const items = await svc.forUser('u1');
    // Order: task_completed (t2) > payment (t1) > task_created (t0).
    expect(items.map((i) => i.kind)).toEqual(['task_completed', 'payment', 'task_created']);
    const pay = items.find((i) => i.kind === 'payment');
    expect(pay).toMatchObject({ amount: 1.5, status: 'CONFIRMED', txHash: 'abc', detail: 'Job' });
  });

  it('respects the limit after merging', async () => {
    const tasks: TaskRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      title: `Job ${i}`,
      status: 'DRAFT',
      budget: 1,
      asset: 'USDC',
      createdAt: new Date(t0.getTime() + i * 1000),
      updatedAt: new Date(t0.getTime() + i * 1000),
    }));
    const svc = makeService(tasks, []);
    const items = await svc.forUser('u1', 3);
    expect(items).toHaveLength(3);
  });
});
