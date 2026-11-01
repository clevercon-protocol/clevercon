import { type PrismaClient, Prisma, DisputeStatus, StepStatus, TaskStatus } from '@clevercon/db';
import {
  validateSchema,
  verifyDelivery,
  type JobRequestEnvelope,
  type JobResultEnvelope,
  type VerificationSpec,
  type JsonSchema,
  type InputRequest,
} from '@clevercon/common';
import {
  enqueueSettlement,
  enqueueStepRelease,
  enqueueStepPoll,
  enqueueTaskExecution,
} from './queue.js';
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
  /** Schedule the next poll of a parked async/needs-input step. */
  scheduleStepPoll?: (stepId: string, delayMs: number) => Promise<void>;
  /** Advisory quality judge for held T2 steps (defaults to the Anthropic judge). */
  judge?: (args: JudgeInput) => Promise<JudgeVerdict | null>;
}

type FetchImpl = typeof fetch;

const STEP_TIMEOUT_MS = 15_000;
const TERMINAL: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED];

/** How often the worker polls an async (status=working) job, in seconds. */
function asyncPollSeconds(): number {
  const n = Number(process.env.ASYNC_POLL_SECONDS ?? 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

/**
 * Hard cap on how long an async job may run (or wait for an answer) before the step
 * fails and the lock refunds, so a stuck provider never strands a lock forever.
 * Measured from the step's creation; configurable per deploy.
 */
function asyncMaxSeconds(): number {
  const n = Number(process.env.ASYNC_MAX_SECONDS ?? 3600);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3600;
}

/** Cast an arbitrary value to a Prisma JSON input (the column type is Json). */
const jsonIn = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

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
 * Build the standard job request for a step. Providers dispatch on the service's
 * CAPABILITY (e.g. "data.hash"), not the step's display label, and any buyer-
 * supplied input attachments are lifted into the envelope so the provider gets
 * them by reference. The `kind` (dispatch/poll/answer) is set by the caller.
 */
function buildBaseRequest(
  step: { id: string; action: string; service?: { capabilities?: string[] | null } | null },
  taskId: string,
  input: Record<string, unknown>,
): JobRequestEnvelope {
  const jobAction = step.service?.capabilities?.[0] ?? step.action;
  const raw = (input as { attachments?: unknown }).attachments;
  const attachments = Array.isArray(raw)
    ? (raw as JobRequestEnvelope['attachments'])
    : undefined;
  return {
    jobId: step.id,
    taskId,
    stepId: step.id,
    action: jobAction,
    input,
    ...(attachments ? { attachments } : {}),
    replyFormat: 'json',
    deadline: Math.floor(Date.now() / 1000) + Math.ceil(STEP_TIMEOUT_MS / 1000),
    idempotencyKey: `${taskId}:${step.id}`,
  };
}

/** Injectable queue producers for the shared accept->hold/release path. */
export interface FinalizeDeps {
  scheduleRelease: (stepId: string, delayMs: number) => Promise<void>;
  enqueueSettle: (stepId: string) => Promise<void>;
  judge: (args: JudgeInput) => Promise<JudgeVerdict | null>;
}

/** Narrow shape of a step row the finalize/park helpers touch. */
type StepRow = {
  id: string;
  action: string;
  serviceId?: string | null;
  providerJobHandle?: string | null;
  status?: string;
  service?: {
    tier?: string | null;
    outputSchema?: unknown;
    verification?: unknown;
    description?: string | null;
  } | null;
};

/**
 * Shared acceptance -> hold/release pipeline for a COMPLETED provider delivery,
 * used by both the initial dispatch (executeTask) and the async poll/answer path
 * (pollStep) so the two share exactly one gate. Throws on a rejected delivery (the
 * caller marks the step FAILED and records the outcome). Returns 'held' (T2 window
 * or T3) or 'released'. Mutates step.status in-memory so a caller's dependency gate
 * sees the fresh status within the same pass.
 */
async function finalizeDelivery(
  prisma: PrismaClient,
  step: StepRow,
  task: { vaultTaskId?: bigint | string | null },
  input: Record<string, unknown>,
  envelope: JobResultEnvelope,
  rawText: string,
  latencyMs: number,
  windowSec: number,
  deps: FinalizeDeps,
): Promise<'held' | 'released'> {
  if (!isAcceptableOutput(rawText)) throw new Error('provider output rejected (acceptance check)');
  const outputSchema = step.service?.outputSchema as JsonSchema | null | undefined;
  if (outputSchema) {
    const schemaCheck = validateSchema(envelope.data, outputSchema);
    if (!schemaCheck.ok) throw new Error(`schema check failed: ${schemaCheck.reason}`);
  }
  const verification = step.service?.verification as VerificationSpec | null | undefined;
  if (step.service?.tier === 'T1' && verification) {
    // Trustless gate: a T1 service is paid only if the declared check passes.
    const v = await verifyDelivery(verification, input, envelope);
    if (!v.ok) throw new Error(`verification failed: ${v.reason}`);
  }
  const storedOutput = (
    typeof envelope.data === 'string'
      ? envelope.data
      : JSON.stringify(envelope.data ?? envelope.artifact ?? '')
  ).slice(0, 2000);
  // A provider may return a file as an ArtifactRef {url, hash, contentType, size};
  // persist it so the buyer can download + verify it (content-hash).
  const artifact = (envelope.artifact ?? null) as object | null;
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
        ...(isT2Window ? { releaseAt: new Date(Date.now() + windowSec * 1000) } : {}),
        ...(artifact ? { artifact: jsonIn(artifact) } : {}),
      },
    });
    step.status = StepStatus.AWAITING_APPROVAL;
    if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
    // Advisory quality signal for the buyer during the window: never gates payment.
    try {
      const verdict = await deps.judge({
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
    if (isT2Window) {
      try {
        await deps.scheduleRelease(step.id, windowSec * 1000);
      } catch {
        // the window can be driven later; the step is safely parked AWAITING_APPROVAL
      }
    }
    return 'held';
  }
  await prisma.taskStep.update({
    where: { id: step.id },
    data: {
      status: StepStatus.RELEASED,
      output: storedOutput,
      latencyMs,
      error: null,
      ...(artifact ? { artifact: jsonIn(artifact) } : {}),
    },
  });
  step.status = StepStatus.RELEASED;
  if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
  if (task.vaultTaskId && step.serviceId) {
    try {
      await deps.enqueueSettle(step.id);
    } catch {
      // settlement can be retried/driven later; do not fail the step
    }
  }
  return 'released';
}

/**
 * Park a long-running (status=working) job: persist the provider's durable handle
 * and last progress, mark the step RUNNING, and schedule the first poll. The task
 * stays non-terminal until the poll queue drives the step to a terminal state.
 */
async function parkWorking(
  prisma: PrismaClient,
  step: StepRow,
  envelope: JobResultEnvelope,
  scheduleStepPoll: (stepId: string, delayMs: number) => Promise<void>,
): Promise<void> {
  if (!envelope.handle) throw new Error('provider returned working without a job handle');
  await prisma.taskStep.update({
    where: { id: step.id },
    data: {
      status: StepStatus.RUNNING,
      providerJobHandle: envelope.handle,
      progress: envelope.progress ? jsonIn(envelope.progress) : Prisma.DbNull,
      error: null,
    },
  });
  step.status = StepStatus.RUNNING;
  step.providerJobHandle = envelope.handle;
  try {
    await scheduleStepPoll(step.id, asyncPollSeconds() * 1000);
  } catch {
    // the poll can be re-driven; the step is parked RUNNING meanwhile
  }
}

/**
 * Park a needs-input (status=input_required) job: persist the provider's question,
 * mark the step INPUT_REQUIRED, and schedule a poll (which enforces the deadline
 * while waiting, and relays the answer once the buyer supplies one).
 */
async function parkInputRequired(
  prisma: PrismaClient,
  step: StepRow,
  envelope: JobResultEnvelope,
  scheduleStepPoll: (stepId: string, delayMs: number) => Promise<void>,
): Promise<void> {
  if (!envelope.inputRequest)
    throw new Error('provider returned input_required without an inputRequest');
  await prisma.taskStep.update({
    where: { id: step.id },
    data: {
      status: StepStatus.INPUT_REQUIRED,
      inputRequest: jsonIn(envelope.inputRequest),
      inputResponse: Prisma.DbNull,
      providerJobHandle: envelope.handle ?? step.providerJobHandle ?? null,
      progress: envelope.progress ? jsonIn(envelope.progress) : Prisma.DbNull,
      error: null,
    },
  });
  step.status = StepStatus.INPUT_REQUIRED;
  try {
    await scheduleStepPoll(step.id, asyncPollSeconds() * 1000);
  } catch {
    // the poll (deadline watch) can be re-driven; the step is parked INPUT_REQUIRED
  }
}

/** Mark a step FAILED and record the failed outcome against the service. */
async function failStep(
  prisma: PrismaClient,
  step: StepRow,
  message: string,
  latencyMs?: number,
): Promise<void> {
  await prisma.taskStep.update({
    where: { id: step.id },
    data: { status: StepStatus.FAILED, error: message, ...(latencyMs != null ? { latencyMs } : {}) },
  });
  step.status = StepStatus.FAILED;
  if (step.serviceId) await recordOutcome(prisma, step.serviceId, false, latencyMs ?? 0);
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
  const scheduleStepPoll = deps.scheduleStepPoll ?? enqueueStepPoll;
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
    // A parked async step (RUNNING with a provider handle) or one waiting on the
    // buyer's answer (INPUT_REQUIRED) is driven by the poll queue, not re-dispatched
    // here; keep the task non-terminal until the poll resolves it.
    if (step.status === StepStatus.RUNNING && step.providerJobHandle) {
      anyHeld = true;
      continue;
    }
    if (step.status === StepStatus.INPUT_REQUIRED) {
      anyHeld = true;
      continue;
    }
    // Dependency gate: a step runs only once every step it depends on has RELEASED.
    // With synchronous steps this was implicit (an earlier step finished in-loop); an
    // async step can park mid-pass, so gate explicitly. A dependency that FAILED or
    // was SKIPPED blocks this step (skip it, task cannot fully complete); a dependency
    // still in flight means wait (leave PENDING; the poll queue re-enqueues the task
    // when the async dependency resolves). A step with no dependsOn is unaffected.
    if (step.dependsOn && step.dependsOn.length) {
      const statusByIndex = new Map(task.steps.map((s) => [s.index, s.status as string]));
      const depStatuses = step.dependsOn.map((d) => statusByIndex.get(d));
      if (depStatuses.some((s) => s === StepStatus.FAILED || s === StepStatus.SKIPPED)) {
        await prisma.taskStep.update({
          where: { id: step.id },
          data: { status: StepStatus.SKIPPED, error: 'dependency did not complete' },
        });
        step.status = StepStatus.SKIPPED;
        anyFailed = true;
        continue;
      }
      if (!depStatuses.every((s) => s === StepStatus.RELEASED)) {
        anyHeld = true;
        continue;
      }
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
    const request: JobRequestEnvelope = { ...buildBaseRequest(step, taskId, input), kind: 'dispatch' };
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
      // Async lifecycle (opt-in). A provider that omits `status` is treated as a
      // completed sync delivery, so every existing provider is unaffected.
      const envelope = parseResultEnvelope(rawText);
      if (envelope.status === 'working') {
        // Long-running job: persist the handle and hand off to the poll queue; the
        // task stays RUNNING until the poll drives the step to a terminal state.
        await parkWorking(prisma, step, envelope, scheduleStepPoll);
        anyHeld = true;
        stepsRun += 1;
        continue;
      }
      if (envelope.status === 'input_required') {
        // The provider needs an answer from the buyer/agent mid-job: park the
        // question; the poll queue enforces the deadline and resumes on an answer.
        await parkInputRequired(prisma, step, envelope, scheduleStepPoll);
        anyHeld = true;
        stepsRun += 1;
        continue;
      }
      if (!envelope.ok || envelope.status === 'failed')
        throw new Error(
          envelope.error ? `provider error: ${envelope.error}` : 'provider delivery rejected',
        );
      // Completed delivery: run the shared acceptance -> hold/release pipeline.
      // Hold semantics: T2 (Attestable) holds for a dispute window then auto-
      // releases unless approved/disputed; T3 (Human) holds for explicit approval;
      // T1 (trustless) releases now (also T2 when the window is disabled).
      const outcome = await finalizeDelivery(
        prisma,
        step,
        task,
        input,
        envelope,
        rawText,
        latencyMs,
        windowSec,
        { scheduleRelease, enqueueSettle, judge },
      );
      if (outcome === 'held') anyHeld = true;
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

/** Injectable producers for pollStep so it stays hermetic in unit tests. */
export interface PollDeps {
  scheduleStepPoll?: (stepId: string, delayMs: number) => Promise<void>;
  scheduleRelease?: (stepId: string, delayMs: number) => Promise<void>;
  enqueueSettle?: (stepId: string) => Promise<void>;
  /** Re-run the task so dependents proceed and the task finalizes (defaults to the queue). */
  reEnqueueTask?: (taskId: string) => Promise<void>;
  judge?: (args: JudgeInput) => Promise<JudgeVerdict | null>;
}

export interface PollStepResult {
  status: 'working' | 'input_required' | 'held' | 'completed' | 'failed' | 'skipped';
  reason?: string;
  buyerId?: string;
  taskId?: string;
  stepId?: string;
}

/**
 * Advance one parked async / needs-input step by calling its provider again:
 *  - a RUNNING step with a handle is polled (`kind: poll`);
 *  - an INPUT_REQUIRED step with a stored answer relays it (`kind: answer`), while
 *    one still awaiting an answer just re-arms the deadline watch (no provider call).
 *
 * The provider's reply drives the same lifecycle as the initial dispatch: `working`
 * re-schedules a poll, `input_required` parks a new question, `completed` runs the
 * shared acceptance -> hold/release pipeline, and `failed`/rejection fails the step.
 * On any terminal outcome the task is re-enqueued so dependents run and the task
 * finalizes. A hard max-duration cap fails the step so a stuck job never strands a
 * lock. Idempotent and safe to replay: a step already resolved is a no-op.
 */
export async function pollStep(
  prisma: PrismaClient,
  fetchImpl: FetchImpl,
  stepId: string,
  deps: PollDeps = {},
): Promise<PollStepResult> {
  const scheduleStepPoll = deps.scheduleStepPoll ?? enqueueStepPoll;
  const scheduleRelease = deps.scheduleRelease ?? enqueueStepRelease;
  const enqueueSettle = deps.enqueueSettle ?? enqueueSettlement;
  const reEnqueueTask = deps.reEnqueueTask ?? enqueueTaskExecution;
  const judge = deps.judge ?? judgeDelivery;

  const step = await prisma.taskStep.findUnique({
    where: { id: stepId },
    include: {
      service: true,
      task: { select: { id: true, status: true, buyerId: true, vaultTaskId: true } },
    },
  });
  if (!step) return { status: 'skipped', reason: 'step not found' };
  const task = step.task;
  if (!task) return { status: 'skipped', reason: 'step has no task', stepId };
  const base = { buyerId: task.buyerId, taskId: task.id, stepId };
  if (TERMINAL.includes(task.status))
    return { status: 'skipped', reason: `task ${task.status.toLowerCase()}`, ...base };
  if (step.status !== StepStatus.RUNNING && step.status !== StepStatus.INPUT_REQUIRED)
    return { status: 'skipped', reason: 'step not awaiting a poll', ...base };

  // Hard deadline: fail a job that has run (or waited for an answer) too long, so
  // the lock refunds instead of stranding. Measured from the step's creation.
  if (Date.now() - step.createdAt.getTime() > asyncMaxSeconds() * 1000) {
    await failStep(prisma, step, 'async job exceeded max duration');
    try {
      await reEnqueueTask(task.id);
    } catch {
      // the task will also finalize via its own stale-task escape hatch
    }
    return { status: 'failed', reason: 'deadline exceeded', ...base };
  }

  const endpoint = step.service?.endpoint;
  if (!endpoint) {
    await failStep(prisma, step, 'no provider endpoint');
    try {
      await reEnqueueTask(task.id);
    } catch {
      /* finalized elsewhere */
    }
    return { status: 'failed', reason: 'no endpoint', ...base };
  }

  // Still waiting on the buyer's answer: do not call the provider, just re-arm the
  // deadline watch (the deadline check above eventually fails it if unanswered).
  if (step.status === StepStatus.INPUT_REQUIRED && !step.inputResponse) {
    try {
      await scheduleStepPoll(stepId, asyncPollSeconds() * 1000);
    } catch {
      /* re-driven later */
    }
    return { status: 'input_required', reason: 'awaiting answer', ...base };
  }

  const input = (step.input as Record<string, unknown> | null) ?? {};
  const baseReq = buildBaseRequest(step, task.id, input);
  let request: JobRequestEnvelope;
  if (step.status === StepStatus.INPUT_REQUIRED && step.inputResponse) {
    const ir = step.inputRequest as InputRequest | null;
    request = {
      ...baseReq,
      kind: 'answer',
      handle: step.providerJobHandle ?? undefined,
      requestId: ir?.requestId,
      inputResponse: step.inputResponse as Record<string, unknown>,
    };
  } else {
    request = { ...baseReq, kind: 'poll', handle: step.providerJobHandle ?? undefined };
  }

  const started = Date.now();
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // A transient provider error during polling is retried (the deadline cap above
      // eventually fails a persistently-down provider); the step stays parked.
      try {
        await scheduleStepPoll(stepId, asyncPollSeconds() * 1000);
      } catch {
        /* re-driven later */
      }
      return { status: 'working', reason: `provider HTTP ${res.status}`, ...base };
    }
    const rawText = (await res.text()).slice(0, 8000);
    const envelope = parseResultEnvelope(rawText);

    if (envelope.status === 'working') {
      await prisma.taskStep.update({
        where: { id: stepId },
        data: {
          status: StepStatus.RUNNING,
          providerJobHandle: envelope.handle ?? step.providerJobHandle,
          progress: envelope.progress ? jsonIn(envelope.progress) : Prisma.DbNull,
          // An answer was consumed to get here; clear it so it is never re-sent.
          inputRequest: Prisma.DbNull,
          inputResponse: Prisma.DbNull,
          error: null,
        },
      });
      try {
        await scheduleStepPoll(stepId, asyncPollSeconds() * 1000);
      } catch {
        /* re-driven later */
      }
      return { status: 'working', ...base };
    }
    if (envelope.status === 'input_required') {
      if (!envelope.inputRequest) {
        await failStep(prisma, step, 'input_required without an inputRequest', latencyMs);
        try {
          await reEnqueueTask(task.id);
        } catch {
          /* finalized elsewhere */
        }
        return { status: 'failed', reason: 'malformed input_required', ...base };
      }
      await prisma.taskStep.update({
        where: { id: stepId },
        data: {
          status: StepStatus.INPUT_REQUIRED,
          inputRequest: jsonIn(envelope.inputRequest),
          inputResponse: Prisma.DbNull,
          providerJobHandle: envelope.handle ?? step.providerJobHandle,
          progress: envelope.progress ? jsonIn(envelope.progress) : Prisma.DbNull,
          error: null,
        },
      });
      try {
        await scheduleStepPoll(stepId, asyncPollSeconds() * 1000);
      } catch {
        /* re-driven later */
      }
      return { status: 'input_required', ...base };
    }
    if (!envelope.ok || envelope.status === 'failed') {
      await failStep(
        prisma,
        step,
        envelope.error ? `provider error: ${envelope.error}` : 'provider delivery rejected',
        latencyMs,
      );
      try {
        await reEnqueueTask(task.id);
      } catch {
        /* finalized elsewhere */
      }
      return { status: 'failed', ...base };
    }

    // Completed: run the shared acceptance -> hold/release pipeline. A rejection
    // (acceptance/schema/verification) throws and is a deterministic failure.
    try {
      const outcome = await finalizeDelivery(
        prisma,
        step,
        task,
        input,
        envelope,
        rawText,
        latencyMs,
        disputeWindowSeconds(),
        { scheduleRelease, enqueueSettle, judge },
      );
      try {
        await reEnqueueTask(task.id);
      } catch {
        /* finalized elsewhere */
      }
      return { status: outcome === 'held' ? 'held' : 'completed', ...base };
    } catch (accErr) {
      await failStep(prisma, step, accErr instanceof Error ? accErr.message : String(accErr), latencyMs);
      try {
        await reEnqueueTask(task.id);
      } catch {
        /* finalized elsewhere */
      }
      return { status: 'failed', ...base };
    }
  } catch {
    // Network/timeout: a transient poll failure retries until the deadline cap.
    try {
      await scheduleStepPoll(stepId, asyncPollSeconds() * 1000);
    } catch {
      /* re-driven later */
    }
    return { status: 'working', reason: 'poll network error', ...base };
  }
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
