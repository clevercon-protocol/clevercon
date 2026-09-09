import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// The task-execution queue: the API enqueues a job when a buyer starts a job,
// and the worker (src/index.ts) drives that task's step state machine. Importing
// this module has no side effects (the queue is created lazily), so the API can
// import the producer without starting a worker.
export const TASK_QUEUE = 'task-execution';

export interface TaskExecutionJob {
  taskId: string;
}

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
}

/** A Redis connection configured for BullMQ (requires maxRetriesPerRequest: null). */
export function redisConnection(): Redis {
  return new Redis(redisUrl(), { maxRetriesPerRequest: null });
}

let queue: Queue<TaskExecutionJob> | null = null;

export function taskQueue(): Queue<TaskExecutionJob> {
  if (!queue) queue = new Queue<TaskExecutionJob>(TASK_QUEUE, { connection: redisConnection() });
  return queue;
}

/**
 * Enqueue a task for execution. The jobId is derived from the taskId so the same
 * task is never queued twice concurrently (idempotent producer); BullMQ retries
 * with exponential backoff on failure.
 */
export async function enqueueTaskExecution(taskId: string): Promise<void> {
  await taskQueue().add(
    'execute',
    { taskId },
    {
      jobId: `task-${taskId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  );
}
