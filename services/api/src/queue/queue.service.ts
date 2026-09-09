import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// Producer side of the task-execution queue. The queue name and job shape MUST
// match the worker in services/workers/src/queue.ts (consumer). Kept as a thin
// local producer so the API does not import the worker's TS source at runtime.
const TASK_QUEUE = 'task-execution';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly url = process.env.REDIS_URL ?? '';
  private queue: Queue | null = null;

  private getQueue(): Queue | null {
    if (!this.url) return null;
    if (!this.queue) {
      const connection = new Redis(this.url, { maxRetriesPerRequest: null });
      this.queue = new Queue(TASK_QUEUE, { connection });
    }
    return this.queue;
  }

  /**
   * Enqueue a task for the worker to execute. Non-fatal: if Redis is not
   * configured or unreachable, the task is still created and can be run later;
   * we never fail task creation because the queue hiccuped.
   */
  async enqueueTaskExecution(taskId: string): Promise<void> {
    const queue = this.getQueue();
    if (!queue) {
      this.logger.warn(`REDIS_URL not set; task ${taskId} created but not enqueued`);
      return;
    }
    try {
      await queue.add(
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
    } catch (err) {
      this.logger.error(`enqueue failed for task ${taskId}: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
