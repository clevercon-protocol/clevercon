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
import { settleStep } from './settlement.js';
import { logger } from './logger.js';

// Load the repo-root .env (DATABASE_URL, REDIS_URL) so this runs standalone.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

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
      return result;
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );
  settlementWorker.on('completed', (job, result) =>
    logger.info({ stepId: job.data.stepId, result }, 'settlement processed'),
  );
  settlementWorker.on('failed', (job, err) =>
    logger.error({ stepId: job?.data.stepId, err: err.message }, 'settlement job failed'),
  );

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
