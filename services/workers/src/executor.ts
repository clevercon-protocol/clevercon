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
      stepsRun += 1;
    } catch (err) {
      await prisma.taskStep.update({
        where: { id: step.id },
        data: {
          status: StepStatus.FAILED,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - started,
        },
      });
      anyFailed = true;
    }
  }

  const status = anyFailed ? TaskStatus.FAILED : TaskStatus.COMPLETED;
  await prisma.task.update({ where: { id: taskId }, data: { status } });
  return { status: anyFailed ? 'failed' : 'completed', stepsRun, buyerId: task.buyerId };
}
