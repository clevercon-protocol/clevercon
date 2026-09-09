import { describe, it, expect, vi } from 'vitest';
import { executeTask } from './executor.js';

interface Step {
  id: string;
  index: number;
  action: string;
  status: string;
  service: { endpoint: string } | null;
  output?: string | null;
  error?: string | null;
  latencyMs?: number | null;
}
interface Task {
  id: string;
  status: string;
  steps: Step[];
}

// Minimal in-memory Prisma double capturing the writes the executor makes.
function mockPrisma(task: Task | null) {
  return {
    task: {
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        if (task) task.status = data.status;
        return task;
      }),
    },
    taskStep: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Step> }) => {
        const s = task?.steps.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const okFetch = vi.fn(async () => new Response('result-body', { status: 200 }));

describe('executeTask', () => {
  it('runs a reachable step and completes the task', async () => {
    const task: Task = {
      id: 't1',
      status: 'DRAFT',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'Pay oracle',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const p = mockPrisma(task);
    const res = await executeTask(p, okFetch as unknown as typeof fetch, 't1');
    expect(res.status).toBe('completed');
    expect(task.status).toBe('COMPLETED');
    expect(task.steps[0].status).toBe('RELEASED');
    expect(task.steps[0].output).toBe('result-body');
    expect(task.steps[0].latencyMs).toBeTypeOf('number');
  });

  it('fails the step (and task) when the provider errors', async () => {
    const task: Task = {
      id: 't2',
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const badFetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const res = await executeTask(mockPrisma(task), badFetch as unknown as typeof fetch, 't2');
    expect(res.status).toBe('failed');
    expect(task.status).toBe('FAILED');
    expect(task.steps[0].status).toBe('FAILED');
    expect(task.steps[0].error).toContain('HTTP 500');
  });

  it('fails a step with no provider endpoint', async () => {
    const task: Task = {
      id: 't3',
      status: 'PENDING',
      steps: [{ id: 's1', index: 0, action: 'x', status: 'PENDING', service: null }],
    };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't3');
    expect(res.status).toBe('failed');
    expect(task.steps[0].error).toBe('no provider endpoint');
  });

  it('is idempotent: already-released steps are skipped', async () => {
    const task: Task = {
      id: 't4',
      status: 'RUNNING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'RELEASED',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const spy = vi.fn(async () => new Response('x', { status: 200 }));
    const res = await executeTask(mockPrisma(task), spy as unknown as typeof fetch, 't4');
    expect(res.status).toBe('completed');
    expect(spy).not.toHaveBeenCalled(); // released step not re-executed
  });

  it('skips a terminal task', async () => {
    const task: Task = { id: 't5', status: 'COMPLETED', steps: [] };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't5');
    expect(res.status).toBe('skipped');
  });

  it('skips a missing task', async () => {
    const res = await executeTask(mockPrisma(null), okFetch as unknown as typeof fetch, 'nope');
    expect(res.status).toBe('skipped');
  });
});
