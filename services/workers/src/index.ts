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
  BATCH_SETTLEMENT_QUEUE,
  STEP_RELEASE_QUEUE,
  STEP_POLL_QUEUE,
  HEALTH_QUEUE,
  healthQueue,
  redisConnection,
  redisUrl,
  type TaskExecutionJob,
  type ProofGenerationJob,
  type SettlementJob,
  type StepReleaseJob,
  type StepPollJob,
} from './queue.js';
import { executeTask, releaseHeldStep, pollStep } from './executor.js';
import { sweepHealth } from './health.js';
import { generateProof } from './prover.js';
import {
  settleStep,
  settleBatch,
  finalizeTaskIfComplete,
  type BatchSettlePayload,
} from './settlement.js';
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
      // Payout alert to the provider: real-time ping + their webhooks ("you got
      // paid"). Only on a genuine settlement, so it reflects money that moved.
      if (result.providerId && result.status === 'settled') {
        const paid = {
          stepId: job.data.stepId,
          taskId: result.taskId,
          amountUsdc: result.amountUsdc,
          service: result.serviceName,
          txHash: result.txHash,
        };
        emitter.to(`user:${result.providerId}`).emit('job.paid', paid);
        await deliverWebhooks(prisma, result.providerId, 'job.paid', paid);
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
          // Fire the completion event only when THIS finalize flipped the task to
          // COMPLETED: PAY/DISBURSE and a held T2 hire complete here (no executor
          // fired their webhook), while a normal hire was already completed by the
          // task-execution worker, so fin.completed is false and we avoid a dup.
          if (fin.completed) {
            emitter
              .to(`user:${result.buyerId}`)
              .emit('task.updated', { taskId: result.taskId, status: 'completed' });
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

  // T2 dispute window: a held step auto-releases when its window elapses (unless
  // it was approved early, disputed, or the task went terminal — releaseHeldStep
  // no-ops in those cases). On release it enqueues the normal settlement.
  const releaseWorker = new Worker<StepReleaseJob>(
    STEP_RELEASE_QUEUE,
    async (job) => {
      const result = await releaseHeldStep(prisma, job.data.stepId);
      if (result.buyerId && result.status === 'released') {
        emitter
          .to(`user:${result.buyerId}`)
          .emit('task.updated', { stepId: job.data.stepId, released: true });
      }
      return result;
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );
  releaseWorker.on('completed', (job, result) =>
    logger.info({ stepId: job.data.stepId, result }, 'step-release processed'),
  );
  releaseWorker.on('failed', (job, err) =>
    logger.error({ stepId: job?.data.stepId, err: err.message }, 'step-release job failed'),
  );

  // Async / needs-input polling: a parked step is driven by delayed jobs on this
  // queue until it reaches a terminal state (pollStep polls the provider, relays a
  // buyer's answer, or fails the step on its deadline). On a terminal outcome it
  // re-enqueues task execution so dependents run and the task finalizes.
  const pollWorker = new Worker<StepPollJob>(
    STEP_POLL_QUEUE,
    async (job) => {
      const result = await pollStep(prisma, fetch, job.data.stepId);
      // Nudge the buyer in real time so the dapp reflects progress / a pending
      // question / the terminal step state without waiting for the task event.
      if (result.buyerId) {
        emitter.to(`user:${result.buyerId}`).emit('task.updated', {
          taskId: result.taskId,
          stepId: result.stepId,
          stepStatus: result.status,
        });
      }
      return result;
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );
  pollWorker.on('completed', (job, result) =>
    logger.info({ stepId: job.data.stepId, result }, 'step-poll processed'),
  );
  pollWorker.on('failed', (job, err) =>
    logger.error({ stepId: job?.data.stepId, err: err.message }, 'step-poll job failed'),
  );

  // pp/2 batch settlement: the client proved; this relayer submits the batch.
  const batchWorker = new Worker<BatchSettlePayload>(
    BATCH_SETTLEMENT_QUEUE,
    async (job) => {
      const result = await settleBatch(prisma, job.data);
      if (result.buyerId && result.status === 'settled') {
        emitter
          .to(`user:${result.buyerId}`)
          .emit('task.updated', { batch: true, settled: true, txHash: result.txHash });
      }
      if (result.status === 'failed' && result.retryable) {
        throw new Error(result.reason ?? 'batch settlement failed');
      }
      return result;
    },
    { connection: redisConnection(), concurrency: SETTLEMENT_CONCURRENCY },
  );
  batchWorker.on('completed', (job, result) =>
    logger.info({ buyerId: job.data.buyerId, result }, 'batch settlement processed'),
  );
  batchWorker.on('failed', (job, err) =>
    logger.error({ buyerId: job?.data.buyerId, err: err.message }, 'batch settlement job failed'),
  );

  // Service health: one repeatable scheduler across all worker instances (BullMQ
  // dedups by scheduler id) pings every listable service's /health on an interval
  // and records an auto-recovering health flag. The public directory hides unhealthy
  // services, so a dead endpoint stops taking hires until it recovers.
  const HEALTH_SWEEP_MS = Math.max(60, Number(process.env.HEALTH_SWEEP_SECONDS ?? 300)) * 1000;
  const healthQ = healthQueue();
  void healthQ
    .upsertJobScheduler('health-sweep', { every: HEALTH_SWEEP_MS }, { name: 'sweep' })
    .catch((err) => logger.error({ err: (err as Error).message }, 'failed to schedule health sweep'));
  const healthWorker = new Worker(
    HEALTH_QUEUE,
    async () => sweepHealth(prisma, fetch),
    { connection: redisConnection(), concurrency: 1 },
  );
  healthWorker.on('completed', (_job, result) => logger.info({ result }, 'health sweep processed'));
  healthWorker.on('failed', (_job, err) =>
    logger.error({ err: err.message }, 'health sweep failed'),
  );

  logger.info(
    { concurrency: CONCURRENCY },
    'task-execution + proof-generation + settlement + step-release + step-poll + health + batch workers up',
  );

  const shutdown = async () => {
    await worker.close();
    await proofWorker.close();
    await settlementWorker.close();
    await releaseWorker.close();
    await pollWorker.close();
    await healthWorker.close();
    await batchWorker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
