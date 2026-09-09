import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Worker } from 'bullmq';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';
import { PrismaClient } from '@clevercon/db';
import { TASK_QUEUE, redisConnection, redisUrl, type TaskExecutionJob } from './queue.js';
import { executeTask } from './executor.js';

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
    console.log(`[workers] task ${job.data.taskId} -> ${JSON.stringify(result)}`),
  );
  worker.on('failed', (job, err) =>
    console.error(`[workers] task ${job?.data.taskId} failed: ${err.message}`),
  );

  console.log(`[workers] task-execution worker up (concurrency ${CONCURRENCY})`);

  const shutdown = async () => {
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
