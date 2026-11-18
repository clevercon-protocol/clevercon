import { describe, it, expect, vi } from 'vitest';
import { TaskMode } from '@clevercon/db';
import { TasksService } from './tasks.service.js';

describe('createTask idempotency', () => {
  it('returns the original task on an idempotent replay, without re-checking the service or creating', async () => {
    const prior = {
      id: 't-hire',
      title: 'Hire',
      description: null,
      mode: 'DIRECT',
      status: 'RUNNING',
      budget: 1,
      asset: 'USDC',
      steps: [{ id: 's0', status: 'PENDING' }],
      payments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      task: { findUnique: vi.fn(async () => prior), create: vi.fn() },
      service: { findUnique: vi.fn() },
    };
    const svc = new TasksService(
      prisma as unknown as ConstructorParameters<typeof TasksService>[0],
    );
    const res = await svc.create('u1', {
      title: 'Hire',
      mode: TaskMode.DIRECT,
      budget: 1,
      serviceId: 'svc1',
      idempotencyKey: 'k1',
    });
    expect(res.id).toBe('t-hire');
    expect(prisma.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buyerId_idempotencyKey: { buyerId: 'u1', idempotencyKey: 'k1' } },
      }),
    );
    // Short-circuited before any service lookup or task creation.
    expect(prisma.service.findUnique).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});
