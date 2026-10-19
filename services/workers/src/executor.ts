import { type PrismaClient, DisputeStatus, StepStatus, TaskStatus } from '@clevercon/db';
import {
  validateSchema,
  verifyDelivery,
  type JobRequestEnvelope,
  type JobResultEnvelope,
  type VerificationSpec,
  type JsonSchema,
} from '@clevercon/common';
import { enqueueSettlement, enqueueStepRelease } from './queue.js';
import { finalizeTaskIfComplete } from './settlement.js';
import { judgeDelivery, type JudgeInput, type JudgeVerdict } from './judge.js';

export interface ExecuteResult {
  // `awaiting` = the task ran but is holding at least one T2 step for its dispute
  // window (not yet terminal, no completion webhook).
  status: 'completed' | 'failed' | 'skipped' | 'awaiting';
  reason?: string;
  stepsRun?: number;
  /** The task's buyer, so the worker can push a real-time update to their room. */
  buyerId?: string;
}

/**
 * Injectable queue producers so the executor stays hermetic in unit tests (no
 * Redis). Default to the real BullMQ producers; tests pass spies.
 */
export interface ExecuteDeps {
  scheduleRelease?: (stepId: string, delayMs: number) => Promise<void>;
  enqueueSettle?: (stepId: string) => Promise<void>;
  /** Advisory quality judge for held T2 steps (defaults to the Anthropic judge). */
  judge?: (args: JudgeInput) => Promise<JudgeVerdict | null>;
}

type FetchImpl = typeof fetch;

const STEP_TIMEOUT_MS = 15_000;
const TERMINAL: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED];

/**
 * The T2 (Attestable) dispute window in seconds: an accepted T2 step is held
 * AWAITING_APPROVAL for this long before auto-releasing, so the buyer can approve
 * early or raise a dispute (the lock IS the escrow). Read at call time so it is
 * configurable per deploy. 0 (the default) disables the hold: T2 releases
 * immediately, matching pre-window behavior — a safe opt-in for operators.
 */
function disputeWindowSeconds(): number {
  const n = Number(process.env.DISPUTE_WINDOW_SECONDS ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Acceptance check: a step is paid only when the provider returned a usable
 * result, not merely a 2xx. This is the minimal, provider-agnostic gate (a
 * non-empty body that is not a soft error). A provider that answers 200 with an
 * empty body or a JSON `{ error: ... }` is rejected, so the vault does not pay
 * for a non-delivery. Richer, service-declared acceptance criteria build on this.
 */
export function isAcceptableOutput(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      (parsed as { error: unknown }).error
    ) {
      return false;
    }
  } catch {
    // Non-JSON, non-empty text is acceptable (e.g. a plain string result).
  }
  return true;
}

/**
 * Normalize a provider response into the standard JobResultEnvelope. New providers
 * return the envelope directly; older ones return a bare value (JSON or text),
 * which we wrap so the acceptance pipeline is uniform. Back-compat is preserved:
 * a provider built before the envelope still settles exactly as before.
 */
export function parseResultEnvelope(text: string): JobResultEnvelope {
  const trimmed = text.trim();
  const now = Math.floor(Date.now() / 1000);
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.ok === 'boolean' &&
      (typeof parsed.issuedAt === 'number' || typeof parsed.contentType === 'string')
    ) {
      return parsed as unknown as JobResultEnvelope;
    }
    return { ok: true, contentType: 'application/json', data: parsed, issuedAt: now };
  } catch {
    return { ok: trimmed.length > 0, contentType: 'text/plain', data: trimmed, issuedAt: now };
  }
}

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
  deps: ExecuteDeps = {},
): Promise<ExecuteResult> {
  const scheduleRelease = deps.scheduleRelease ?? enqueueStepRelease;
  const enqueueSettle = deps.enqueueSettle ?? enqueueSettlement;
  const judge = deps.judge ?? judgeDelivery;
  const windowSec = disputeWindowSeconds();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { index: 'asc' }, include: { service: true } } },
  });
  if (!task) return { status: 'skipped', reason: 'task not found' };
  if (TERMINAL.includes(task.status))
    return { status: 'skipped', reason: 'task already terminal', buyerId: task.buyerId };

  await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.RUNNING } });

  let anyFailed = false;
  let anyHeld = false;
  let stepsRun = 0;
  for (const step of task.steps) {
    if (step.status === StepStatus.RELEASED) continue; // idempotent replay
    // A held T2 step is already awaiting its window: do not re-call the provider,
    // and keep the task non-terminal (RUNNING) so a replay does not complete it.
    if (step.status === StepStatus.AWAITING_APPROVAL) {
      anyHeld = true;
      continue;
    }

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
    const input = (step.input as Record<string, unknown> | null) ?? {};
    // Providers dispatch on the service's CAPABILITY (e.g. "data.hash"), not the
    // step's display label ("Pay <name>"). Send the first declared capability so
    // the right handler runs; fall back to the label for capability-less services.
    const jobAction = step.service?.capabilities?.[0] ?? step.action;
    const request: JobRequestEnvelope = {
      jobId: step.id,
      taskId,
      stepId: step.id,
      action: jobAction,
      input,
      replyFormat: 'json',
      deadline: Math.floor(Date.now() / 1000) + Math.ceil(STEP_TIMEOUT_MS / 1000),
      idempotencyKey: `${taskId}:${step.id}`,
    };
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // action/taskId stay top-level for pre-envelope providers; the rest is additive.
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
      const rawText = (await res.text()).slice(0, 8000);
      // Acceptance pipeline: delivery gate -> schema check -> tier verification.
      const envelope = parseResultEnvelope(rawText);
      if (!envelope.ok)
        throw new Error(envelope.error ? `provider error: ${envelope.error}` : 'provider delivery rejected');
      if (!isAcceptableOutput(rawText))
        throw new Error('provider output rejected (acceptance check)');
      const outputSchema = step.service?.outputSchema as JsonSchema | null | undefined;
      if (outputSchema) {
        const schemaCheck = validateSchema(envelope.data, outputSchema);
        if (!schemaCheck.ok) throw new Error(`schema check failed: ${schemaCheck.reason}`);
      }
      const verification = step.service?.verification as VerificationSpec | null | undefined;
      if (step.service?.tier === 'T1' && verification) {
        // Trustless gate: a T1 service is paid only if the declared check passes.
        // `deferred` (onchain without a worker-side deriver) passes here; the buyer
        // agent verifies it trustlessly before accepting.
        const v = await verifyDelivery(verification, input, envelope);
        if (!v.ok) throw new Error(`verification failed: ${v.reason}`);
      }
      const storedOutput = (
        typeof envelope.data === 'string'
          ? envelope.data
          : JSON.stringify(envelope.data ?? envelope.artifact ?? '')
      ).slice(0, 2000);
      // A provider may return a file as an ArtifactRef {url, hash, contentType,
      // size}; persist it so the buyer can download + verify it (content-hash).
      const artifact = (envelope.artifact ?? null) as object | null;
      // Hold the payout after acceptance for the human-in-the-loop tiers:
      //  - T2 (Attestable): held for a dispute window, then auto-releases unless
      //    the buyer approves early or disputes (the lock is the escrow).
      //  - T3 (Human): held indefinitely until the buyer explicitly approves (no
      //    timer); for milestone/approval work where only the buyer can judge.
      // T1 is trustless (already verified) and releases now; with the window
      // disabled (0), T2 also releases now, but T3 always holds.
      const tier = step.service?.tier;
      const isT2Window = tier === 'T2' && windowSec > 0;
      const isT3 = tier === 'T3';
      const held = isT2Window || isT3;
      if (held) {
        await prisma.taskStep.update({
          where: { id: step.id },
          data: {
            status: StepStatus.AWAITING_APPROVAL,
            output: storedOutput,
            latencyMs,
            error: null,
            // T2 carries a countdown to auto-release; T3 waits for approval (no timer).
            ...(isT2Window ? { releaseAt: new Date(Date.now() + windowSec * 1000) } : {}),
            ...(artifact ? { artifact } : {}),
          },
        });
        if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
        anyHeld = true;
        // Advisory quality signal for the buyer during the window: never gates
        // payment, never auto-releases/disputes. No-ops without ANTHROPIC_API_KEY.
        try {
          const verdict = await judge({
            description: step.service?.description ?? step.action,
            action: step.action,
            input,
            output: envelope.data,
          });
          if (verdict) {
            await prisma.taskStep.update({
              where: { id: step.id },
              data: { qualityRating: verdict.rating, qualityNote: verdict.note || null },
            });
          }
        } catch {
          // judging is advisory; never fail the step over it
        }
        // Only T2 schedules a timed auto-release; a T3 step is released solely by
        // the buyer's explicit approval (POST /tasks/:id/approve).
        if (isT2Window) {
          try {
            await scheduleRelease(step.id, windowSec * 1000);
          } catch {
            // The window can be driven later (approve-early or a re-schedule); the
            // step is safely parked AWAITING_APPROVAL in the meantime.
          }
        }
      } else {
        await prisma.taskStep.update({
          where: { id: step.id },
          data: {
            status: StepStatus.RELEASED,
            output: storedOutput,
            latencyMs,
            error: null,
            ...(artifact ? { artifact } : {}),
          },
        });
        if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
        // If the task is locked on-chain under a policy, settle this step (pay the
        // provider via a proof-gated release) out of band. Non-fatal: execution
        // never fails because settlement could not be enqueued.
        if (task.vaultTaskId && step.serviceId) {
          try {
            await enqueueSettle(step.id);
          } catch {
            // settlement can be retried/driven later; do not fail the step
          }
        }
      }
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

  // A held task stays RUNNING: its T2 steps are AWAITING_APPROVAL until the window
  // elapses (or the buyer approves/disputes), so it is not yet terminal and gets
  // no completion webhook. finalizeTaskIfComplete also skips while a step is held.
  const status = anyFailed ? TaskStatus.FAILED : anyHeld ? TaskStatus.RUNNING : TaskStatus.COMPLETED;
  await prisma.task.update({ where: { id: taskId }, data: { status } });
  // Finalize the on-chain task if nothing settled (e.g. all steps failed), so the
  // locked budget is unlocked instead of stranded. When steps DID release, this is
  // a no-op here (settlement finalizes after the releases land); both are idempotent.
  if (task.vaultTaskId) {
    try {
      await finalizeTaskIfComplete(prisma, taskId);
    } catch {
      // finalization is best-effort here; the settlement path and the on-chain
      // stale-task escape hatch both cover it.
    }
  }
  return {
    status: anyFailed ? 'failed' : anyHeld ? 'awaiting' : 'completed',
    stepsRun,
    buyerId: task.buyerId,
  };
}

/** The injectable settlement producer for releaseHeldStep (hermetic in tests). */
export interface ReleaseDeps {
  enqueueSettle?: (stepId: string) => Promise<void>;
}

export interface ReleaseHeldResult {
  status: 'released' | 'skipped';
  reason?: string;
  buyerId?: string;
  taskId?: string;
}

/**
 * Auto-release a T2 step whose dispute window has elapsed. Idempotent and safe to
 * replay: it releases ONLY a step still AWAITING_APPROVAL on a non-frozen task
 * with no open dispute, then enqueues settlement (the same proof-gated vault
 * release as a T1 step). If the step was approved early, already released, or the
 * task is disputed/cancelled/failed, it no-ops so the timer never fights the
 * buyer or the resolver. For a task not locked on-chain (no settlement path) it
 * completes the task here once no step is still open.
 */
export async function releaseHeldStep(
  prisma: PrismaClient,
  stepId: string,
  deps: ReleaseDeps = {},
): Promise<ReleaseHeldResult> {
  const enqueueSettle = deps.enqueueSettle ?? enqueueSettlement;
  const step = await prisma.taskStep.findUnique({
    where: { id: stepId },
    include: {
      task: { select: { id: true, status: true, buyerId: true, vaultTaskId: true } },
    },
  });
  if (!step) return { status: 'skipped', reason: 'step not found' };
  const task = step.task;
  if (!task) return { status: 'skipped', reason: 'step has no task' };
  const buyerId = task.buyerId;
  if (step.status !== StepStatus.AWAITING_APPROVAL)
    return { status: 'skipped', reason: 'step not awaiting approval', buyerId, taskId: task.id };
  // A frozen task pauses the window: a dispute (on-chain freeze) or any terminal
  // state means the resolver or buyer decides the outcome, not the timer.
  if (
    task.status === TaskStatus.DISPUTED ||
    task.status === TaskStatus.CANCELLED ||
    task.status === TaskStatus.FAILED
  )
    return { status: 'skipped', reason: `task ${task.status.toLowerCase()}`, buyerId, taskId: task.id };
  const openDisputes = await prisma.dispute.count({
    where: { taskId: task.id, status: DisputeStatus.OPEN },
  });
  if (openDisputes > 0)
    return { status: 'skipped', reason: 'dispute open', buyerId, taskId: task.id };

  // The window elapsed with no dispute: release and settle.
  await prisma.taskStep.update({
    where: { id: stepId },
    data: { status: StepStatus.RELEASED, releaseAt: null },
  });
  if (task.vaultTaskId && step.serviceId) {
    try {
      await enqueueSettle(stepId);
    } catch {
      // settlement can be driven later; the step is released regardless
    }
  } else {
    // No on-chain settlement to finalize this task, so complete it here once no
    // step is still open (a locked task is completed by finalizeTaskIfComplete).
    const stillOpen = await prisma.taskStep.count({
      where: {
        taskId: task.id,
        status: {
          in: [StepStatus.PENDING, StepStatus.RUNNING, StepStatus.AWAITING_APPROVAL],
        },
      },
    });
    if (stillOpen === 0)
      await prisma.task.update({ where: { id: task.id }, data: { status: TaskStatus.COMPLETED } });
  }
  return { status: 'released', buyerId, taskId: task.id };
}
