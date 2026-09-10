import { type PrismaClient, StepStatus, TaskStatus } from '@clevercon/db';

export interface ExecuteResult {
  status: 'completed' | 'failed' | 'skipped';
  reason?: string;
  stepsRun?: number;
  /** The task's buyer, so the worker can push a real-time update to their room. */
  buyerId?: string;
}

type FetchImpl = typeof fetch;

const STEP_TIMEOUT_MS = 15_000;
const TERMINAL: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED];

/**
 * Record a real job outcome against a service's reputation and health. Called
 * only when the provider endpoint was actually contacted, so these numbers
 * reflect genuine execution, never fabricated activity:
 *  - totalJobs / successfulJobs / failedJobs are incremented atomically (exact
 *    under concurrency),
 *  - score is a reliability rating (success rate on a 0-5 scale) recomputed from
 *    the fresh counts,
 *  - avgLatencyMs is a running mean over successful calls,
 *  - the service's lastSeen is stamped on a successful call (health signal).
 * Best-effort: a reputation write failure never fails the task execution.
 */
async function recordOutcome(
  prisma: PrismaClient,
  serviceId: string,
  success: boolean,
  latencyMs: number,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Atomic counter increments keep the counts exact even if several steps
      // for the same service settle at once.
      const rep = await tx.serviceReputation.update({
        where: { serviceId },
        data: {
          totalJobs: { increment: 1 },
          successfulJobs: { increment: success ? 1 : 0 },
          failedJobs: { increment: success ? 0 : 1 },
        },
      });
      const score = Math.round((rep.successfulJobs / rep.totalJobs) * 5 * 10) / 10;
      let avgLatencyMs = rep.avgLatencyMs;
      if (success) {
        const prevSuccessful = rep.successfulJobs - 1;
        avgLatencyMs = Math.round(
          (rep.avgLatencyMs * prevSuccessful + latencyMs) / rep.successfulJobs,
        );
      }
      await tx.serviceReputation.update({ where: { serviceId }, data: { score, avgLatencyMs } });
      if (success) {
        await tx.service.update({ where: { id: serviceId }, data: { lastSeen: new Date() } });
      }
    });
  } catch {
    // A reputation/health update is non-critical; never fail execution over it.
  }
}

/**
 * Drive one task's step state machine: mark it RUNNING, call each step's provider
 * endpoint, record the output/latency and mark the step RELEASED, or FAILED with
 * the error. Then settle the task to COMPLETED (all steps released) or FAILED.
 *
 * Idempotent: already-released steps are skipped and a terminal task is a no-op,
 * so BullMQ retries never double-execute a step.
 *
 * Note: this performs orchestration/execution only. On-chain payment/settlement
 * per released step (x402 / vault release) is a separate worker job and is not
 * done here, so no Payment rows are fabricated.
 */
export async function executeTask(
  prisma: PrismaClient,
  fetchImpl: FetchImpl,
  taskId: string,
): Promise<ExecuteResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { index: 'asc' }, include: { service: true } } },
  });
  if (!task) return { status: 'skipped', reason: 'task not found' };
  if (TERMINAL.includes(task.status))
    return { status: 'skipped', reason: 'task already terminal', buyerId: task.buyerId };

  await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.RUNNING } });

  let anyFailed = false;
  let stepsRun = 0;
  for (const step of task.steps) {
    if (step.status === StepStatus.RELEASED) continue; // idempotent replay

    const endpoint = step.service?.endpoint;
    if (!endpoint) {
      await prisma.taskStep.update({
        where: { id: step.id },
        data: { status: StepStatus.FAILED, error: 'no provider endpoint' },
      });
      anyFailed = true;
      continue;
    }

    const started = Date.now();
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: step.action, taskId }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
      const output = (await res.text()).slice(0, 2000);
      await prisma.taskStep.update({
        where: { id: step.id },
        data: { status: StepStatus.RELEASED, output, latencyMs, error: null },
      });
      if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
      stepsRun += 1;
    } catch (err) {
      const latencyMs = Date.now() - started;
      await prisma.taskStep.update({
        where: { id: step.id },
        data: {
          status: StepStatus.FAILED,
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
        },
      });
      // The endpoint was contacted and failed, so it counts against the provider.
      if (step.serviceId) await recordOutcome(prisma, step.serviceId, false, latencyMs);
      anyFailed = true;
    }
  }

  const status = anyFailed ? TaskStatus.FAILED : TaskStatus.COMPLETED;
  await prisma.task.update({ where: { id: taskId }, data: { status } });
  return { status: anyFailed ? 'failed' : 'completed', stepsRun, buyerId: task.buyerId };
}
