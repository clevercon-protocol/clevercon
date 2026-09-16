import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// Producer side of the worker queues. The queue names and job shapes MUST match
// the workers in services/workers/src/queue.ts (consumers). Kept as thin local
// producers so the API does not import the worker's TS source at runtime.
const TASK_QUEUE = 'task-execution';
const PROOF_QUEUE = 'proof-generation';
const SETTLEMENT_QUEUE = 'settlement';

export interface ProofGenerationJob {
  proofId: string;
  payeeAddress: string;
  amountStroops: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly url = process.env.REDIS_URL ?? '';
  private queue: Queue | null = null;
  private proofQueue: Queue | null = null;
  private settlementQueue: Queue | null = null;
  private connection: Redis | null = null;

  private getConnection(): Redis | null {
    if (!this.url) return null;
    if (!this.connection) this.connection = new Redis(this.url, { maxRetriesPerRequest: null });
    return this.connection;
  }

  private getQueue(): Queue | null {
    const connection = this.getConnection();
    if (!connection) return null;
    if (!this.queue) this.queue = new Queue(TASK_QUEUE, { connection });
    return this.queue;
  }

  private getProofQueue(): Queue | null {
    const connection = this.getConnection();
    if (!connection) return null;
    if (!this.proofQueue) this.proofQueue = new Queue(PROOF_QUEUE, { connection });
    return this.proofQueue;
  }

  private getSettlementQueue(): Queue | null {
    const connection = this.getConnection();
    if (!connection) return null;
    if (!this.settlementQueue) this.settlementQueue = new Queue(SETTLEMENT_QUEUE, { connection });
    return this.settlementQueue;
  }

  /**
   * Enqueue a direct release for a PAY/DISBURSE step. Same queue and job shape as
   * the worker's settlement producer (jobId per step so a line is never double
   * paid). Non-fatal: a queue hiccup leaves the step to be settled on retry.
   */
  async enqueueSettlement(stepId: string): Promise<void> {
    const queue = this.getSettlementQueue();
    if (!queue) {
      this.logger.warn(`REDIS_URL not set; step ${stepId} not enqueued for settlement`);
      return;
    }
    try {
      await queue.add(
        'settle',
        { stepId },
        {
          jobId: `settle-${stepId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: 200,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      this.logger.error(`enqueue settlement failed for step ${stepId}: ${(err as Error).message}`);
    }
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

  /**
   * Enqueue binding-proof generation for a release. Non-fatal like task
   * enqueue: the Proof row is already persisted (REQUESTED), so a queue hiccup
   * just leaves it pending rather than failing the request.
   */
  async enqueueProofGeneration(job: ProofGenerationJob): Promise<void> {
    const queue = this.getProofQueue();
    if (!queue) {
      this.logger.warn(`REDIS_URL not set; proof ${job.proofId} created but not enqueued`);
      return;
    }
    try {
      await queue.add('generate', job, {
        jobId: `proof-${job.proofId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 1000,
      });
    } catch (err) {
      this.logger.error(`enqueue failed for proof ${job.proofId}: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.proofQueue?.close();
    await this.settlementQueue?.close();
    await this.connection?.quit();
  }
}
