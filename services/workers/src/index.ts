import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Worker } from 'bullmq';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';
import { PrismaClient } from '@clevercon/db';
import {
  TASK_QUEUE,
  PROOF_QUEUE,
  SETTLEMENT_QUEUE,
  redisConnection,
  redisUrl,
  type TaskExecutionJob,
  type ProofGenerationJob,
  type SettlementJob,
} from './queue.js';
import { executeTask } from './executor.js';
import { generateProof } from './prover.js';
import { settleStep, finalizeTaskIfComplete } from './settlement.js';
import { deliverWebhooks } from './webhooks.js';
import { logger } from './logger.js';

// Load the repo-root .env (DATABASE_URL, REDIS_URL) so this runs standalone.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
// On-chain releases are signed by per-user delegate keys. The settlement path now
// serializes per signer (delegateMutex) and retries a stale sequence (txBadSeq),
// so the worker can run concurrently: different users settle in parallel while one
// user's releases stay ordered. Bump this to parallelize across delegates.
const SETTLEMENT_CONCURRENCY = Number(process.env.SETTLEMENT_CONCURRENCY ?? 5);

function main(): void {
  const prisma = new PrismaClient();
  // Emit to socket.io rooms served by the API instances (via the Redis adapter),
  // so a buyer sees their task update in real time even though this is a separate
  // process from the API.
  const emitter = new Emitter(new Redis(redisUrl(), { maxRetriesPerRequest: null }));

  const worker = new Worker<TaskExecutionJob>(
    TASK_QUEUE,
    async (job) => {
      const result = await executeTask(prisma, fetch, job.data.taskId);
      if (result.buyerId) {
        emitter
          .to(`user:${result.buyerId}`)
          .emit('task.updated', { taskId: job.data.taskId, status: result.status });
        // Notify the buyer's registered webhooks of the terminal outcome.
        if (result.status === 'completed' || result.status === 'failed') {
          await deliverWebhooks(prisma, result.buyerId, `task.${result.status}`, {
            taskId: job.data.taskId,
            status: result.status,
            stepsRun: result.stepsRun,
          });
        }
      }
      return result;
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );

  worker.on('completed', (job, result) =>
    logger.info({ taskId: job.data.taskId, result }, 'task completed'),
  );
  worker.on('failed', (job, err) =>
    logger.error({ taskId: job?.data.taskId, err: err.message }, 'task failed'),
  );

  const proofWorker = new Worker<ProofGenerationJob>(
    PROOF_QUEUE,
    async (job) => {
      const result = await generateProof(
        prisma,
        job.data.proofId,
        job.data.payeeAddress,
        BigInt(job.data.amountStroops),
      );
      if (result.buyerId) {
        emitter
          .to(`user:${result.buyerId}`)
          .emit('proof.updated', { proofId: job.data.proofId, status: result.status });
      }
      return result;
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );

  proofWorker.on('completed', (job, result) =>
    logger.info({ proofId: job.data.proofId, result }, 'proof generated'),
  );
  proofWorker.on('failed', (job, err) =>
    logger.error({ proofId: job?.data.proofId, err: err.message }, 'proof generation failed'),
  );

  const settlementWorker = new Worker<SettlementJob>(
    SETTLEMENT_QUEUE,
    async (job) => {
      const result = await settleStep(prisma, job.data.stepId);
      if (result.buyerId && result.status === 'settled') {
        emitter.to(`user:${result.buyerId}`).emit('task.updated', {
          stepId: job.data.stepId,
          settled: true,
          txHash: result.txHash,
        });
      }
      // A transient failure (RPC blip, timeout, sequence contention) should retry
      // with backoff: throw so BullMQ re-runs the job (settleStep is idempotent,
      // so a replayed release/lock never moves funds twice). A deterministic
      // failure returns without throwing, so the job stops retrying.
      if (result.status === 'failed' && result.retryable) {
        throw new Error(result.reason ?? 'settlement failed');
      }
      // A deterministic failure that moved the task to FAILED is terminal (a
      // pay/disburse could not lock); notify the buyer's webhooks, since these
      // tasks have no executor to do it.
      if (result.status === 'failed' && result.taskFailed && result.taskId && result.buyerId) {
        emitter
          .to(`user:${result.buyerId}`)
          .emit('task.updated', { taskId: result.taskId, status: 'failed' });
        await deliverWebhooks(prisma, result.buyerId, 'task.failed', {
          taskId: result.taskId,
          status: 'failed',
        });
      }
      // Finalize the on-chain task once all its releases have settled: unlocks
      // the remaining budget and decrements the active-task count. Idempotent.
      if (result.taskId) {
        const fin = await finalizeTaskIfComplete(prisma, result.taskId);
        if (fin.status === 'finalized' && result.buyerId) {
          emitter.to(`user:${result.buyerId}`).emit('task.updated', {
            taskId: result.taskId,
            finalized: true,
          });
          // PAY/DISBURSE tasks complete here (no executor fires their webhook), so
          // deliver the terminal event. A hire's completion webhook is delivered
          // by the task-execution worker, so skip those to avoid a duplicate.
          if (fin.mode === 'PAY' || fin.mode === 'DISBURSE') {
            await deliverWebhooks(prisma, result.buyerId, 'task.completed', {
              taskId: result.taskId,
              status: 'completed',
            });
          }
        }
      }
      return result;
    },
    { connection: redisConnection(), concurrency: SETTLEMENT_CONCURRENCY },
  );
  settlementWorker.on('completed', (job, result) =>
    logger.info({ stepId: job.data.stepId, result }, 'settlement processed'),
  );
  settlementWorker.on('failed', async (job, err) => {
    logger.error({ stepId: job?.data.stepId, err: err.message }, 'settlement job failed');
    // Once a settlement has exhausted all its retries, the step will never pay;
    // mark its task FAILED so it does not dangle as RUNNING forever.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        const step = await prisma.taskStep.findUnique({
          where: { id: job.data.stepId },
          select: { taskId: true, task: { select: { status: true, buyerId: true } } },
        });
        if (step && step.task.status === 'RUNNING') {
          await prisma.task.update({ where: { id: step.taskId }, data: { status: 'FAILED' } });
          logger.error(
            { taskId: step.taskId, stepId: job.data.stepId },
            'settlement exhausted retries; task marked FAILED',
          );
          emitter
            .to(`user:${step.task.buyerId}`)
            .emit('task.updated', { taskId: step.taskId, status: 'failed' });
          await deliverWebhooks(prisma, step.task.buyerId, 'task.failed', {
            taskId: step.taskId,
            status: 'failed',
          });
        }
      } catch (e) {
        logger.error(
          { stepId: job.data.stepId, err: (e as Error).message },
          'failed to mark task FAILED after retry exhaustion',
        );
      }
    }
  });

  logger.info(
    { concurrency: CONCURRENCY },
    'task-execution + proof-generation + settlement workers up',
  );

  const shutdown = async () => {
    await worker.close();
    await proofWorker.close();
    await settlementWorker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
