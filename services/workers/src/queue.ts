import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// The task-execution queue: the API enqueues a job when a buyer starts a job,
// and the worker (src/index.ts) drives that task's step state machine. Importing
// this module has no side effects (the queue is created lazily), so the API can
// import the producer without starting a worker.
export const TASK_QUEUE = 'task-execution';
// The proof-generation queue: the API enqueues a job when a proof-gated release
// needs a binding proof; the worker builds it and drives the `proofs` table.
export const PROOF_QUEUE = 'proof-generation';
// The settlement queue: after a step is released on an on-chain-locked task, the
// worker pays the provider via a proof-gated vault release and records it.
export const SETTLEMENT_QUEUE = 'settlement';

export interface TaskExecutionJob {
  taskId: string;
}

export interface ProofGenerationJob {
  proofId: string;
  payeeAddress: string;
  /** Release amount in stroops, as a string (BullMQ payloads are JSON). */
  amountStroops: string;
}

export interface SettlementJob {
  stepId: string;
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

let proofQueue: Queue<ProofGenerationJob> | null = null;

export function proofGenerationQueue(): Queue<ProofGenerationJob> {
  if (!proofQueue)
    proofQueue = new Queue<ProofGenerationJob>(PROOF_QUEUE, { connection: redisConnection() });
  return proofQueue;
}

/**
 * Enqueue binding-proof generation for a release. The jobId is derived from the
 * proofId so the same proof is never generated twice concurrently (idempotent).
 */
export async function enqueueProofGeneration(job: ProofGenerationJob): Promise<void> {
  await proofGenerationQueue().add('generate', job, {
    jobId: `proof-${job.proofId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 1000,
  });
}

let settlementQueueInstance: Queue<SettlementJob> | null = null;

export function settlementQueue(): Queue<SettlementJob> {
  if (!settlementQueueInstance)
    settlementQueueInstance = new Queue<SettlementJob>(SETTLEMENT_QUEUE, {
      connection: redisConnection(),
    });
  return settlementQueueInstance;
}

/** Enqueue settlement for a released step. jobId per step so it is never double-settled. */
export async function enqueueSettlement(stepId: string): Promise<void> {
  await settlementQueue().add(
    'settle',
    { stepId },
    {
      jobId: `settle-${stepId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  );
}
