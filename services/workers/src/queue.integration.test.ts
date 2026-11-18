/**
 * Integration test for the task queue against a real Redis. Runs only when
 * REDIS_URL is set (CI/local with Redis); skipped otherwise so the default unit
 * run opens no connections.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Worker } from 'bullmq';
import { TASK_QUEUE, redisConnection, enqueueTaskExecution, taskQueue } from './queue.js';

const REDIS = process.env.REDIS_URL;

describe.skipIf(!REDIS)('task queue (integration, real Redis)', () => {
  const connection = REDIS ? redisConnection() : null;

  afterAll(async () => {
    await taskQueue().close();
    await connection?.quit();
  });

  it('enqueues a job that a worker then receives', async () => {
    const taskId = 'it-' + Date.now();
    let resolveSeen: (id: string) => void;
    const seen = new Promise<string>((r) => (resolveSeen = r));

    const worker = new Worker(
      TASK_QUEUE,
      async (job) => {
        resolveSeen(job.data.taskId);
        return { ok: true };
      },
      { connection: connection! },
    );

    await enqueueTaskExecution(taskId);
    const received = await Promise.race([
      seen,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    expect(received).toBe(taskId);
    await worker.close();
  });
});
