/**
 * In-process metrics counters for the orchestrator.
 *
 * Dependency-free by design: a plain counters object with increment helpers,
 * exposed as JSON by `GET /metrics`. Task lifecycle transitions are driven from
 * `server.ts`'s `runTask()`; step and payment counters from `executor.ts`.
 *
 * Counters are per-process and reset on restart. `seedMetrics()` restores what
 * is still knowable from the persisted stores so a redeploy doesn't zero the
 * totals.
 */

/** Number of step-duration samples retained for percentile calculation. */
const DURATION_SAMPLE_CAPACITY = 1024;

export interface StepDurationSummary {
  /** Samples currently retained (never exceeds DURATION_SAMPLE_CAPACITY). */
  count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

export interface MetricsSnapshot {
  uptime_seconds: number;
  tasks: {
    /** Tasks submitted (including those seeded from the activity log). */
    total: number;
    /** Currently in flight in this process. */
    active: number;
    completed: number;
    failed: number;
    /** Tasks that were in flight when a previous process exited. */
    interrupted: number;
  };
  steps: {
    /** Step attempts that finished, successfully or not. */
    executed: number;
    failed: number;
    /** Subset of `failed` whose error looks like a timeout. */
    timed_out: number;
  };
  usdc_released_total: number;
  step_duration_ms: StepDurationSummary;
  memory: {
    rss_bytes: number;
    heap_used_bytes: number;
  };
}

interface Counters {
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  tasks_interrupted: number;
  steps_executed: number;
  steps_failed: number;
  steps_timed_out: number;
  usdc_released_total: number;
}

function emptyCounters(): Counters {
  return {
    tasks_total: 0,
    tasks_completed: 0,
    tasks_failed: 0,
    tasks_interrupted: 0,
    steps_executed: 0,
    steps_failed: 0,
    steps_timed_out: 0,
    usdc_released_total: 0,
  };
}

let counters = emptyCounters();
let startedAt = Date.now();

/**
 * Task IDs currently in flight. Tracking IDs rather than a bare count makes the
 * terminal transitions idempotent: a task that fails after partially completing
 * can only be counted once, and can never sit in `active` and `failed` at the
 * same time.
 */
let activeTasks = new Set<string>();

/**
 * Ring buffer of recent step durations. Bounded memory: once full, the oldest
 * sample is overwritten, so percentiles describe the most recent
 * DURATION_SAMPLE_CAPACITY steps rather than all history.
 */
let durationSamples: number[] = [];
let durationCursor = 0;

const TIMEOUT_PATTERN = /\btimed?[\s-]?out\b|\btimeout\b|aborted/i;

/** True if `error` reads like a timeout rather than a generic failure. */
export function isTimeoutError(error: string | null | undefined): boolean {
  return !!error && TIMEOUT_PATTERN.test(error);
}

/** Record a task entering the pipeline. */
export function taskStarted(taskId: string): void {
  if (activeTasks.has(taskId)) return;
  activeTasks.add(taskId);
  counters.tasks_total++;
}

/**
 * Record a task reaching a terminal state. No-op if the task was already
 * finalised, so the success path and the error handler can both call it.
 */
export function taskCompleted(taskId: string): void {
  if (!activeTasks.delete(taskId)) return;
  counters.tasks_completed++;
}

/** Record a task failing. See {@link taskCompleted} for idempotency notes. */
export function taskFailed(taskId: string): void {
  if (!activeTasks.delete(taskId)) return;
  counters.tasks_failed++;
}

/** Record a completed step attempt and its wall-clock duration. */
export function stepExecuted(latencyMs: number): void {
  counters.steps_executed++;
  recordDuration(latencyMs);
}

/**
 * Record a failed step attempt. Failures also count toward `steps_executed`;
 * `error` is classified so timeouts can be tracked separately.
 */
export function stepFailed(error: string | null | undefined, latencyMs: number): void {
  counters.steps_executed++;
  counters.steps_failed++;
  if (isTimeoutError(error)) counters.steps_timed_out++;
  recordDuration(latencyMs);
}

/** Record USDC released from the vault to the orchestrator wallet. */
export function usdcReleased(amountUsdc: number): void {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return;
  counters.usdc_released_total += amountUsdc;
}

function recordDuration(latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  if (durationSamples.length < DURATION_SAMPLE_CAPACITY) {
    durationSamples.push(latencyMs);
    return;
  }
  durationSamples[durationCursor] = latencyMs;
  durationCursor = (durationCursor + 1) % DURATION_SAMPLE_CAPACITY;
}

/**
 * Nearest-rank percentile over the retained samples. `p` is a fraction (0.95
 * for p95). Returns null when no samples have been recorded.
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summariseDurations(): StepDurationSummary {
  const sorted = [...durationSamples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    max_ms: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}

/** Snapshot of every counter, for `GET /metrics`. */
export function getMetrics(): MetricsSnapshot {
  const mem = process.memoryUsage();
  return {
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    tasks: {
      total: counters.tasks_total,
      active: activeTasks.size,
      completed: counters.tasks_completed,
      failed: counters.tasks_failed,
      interrupted: counters.tasks_interrupted,
    },
    steps: {
      executed: counters.steps_executed,
      failed: counters.steps_failed,
      timed_out: counters.steps_timed_out,
    },
    // Rounded to stroop precision — floating-point accumulation of many small
    // payments otherwise surfaces as 0.06999999999999999.
    usdc_released_total: Math.round(counters.usdc_released_total * 1e7) / 1e7,
    step_duration_ms: summariseDurations(),
    memory: {
      rss_bytes: mem.rss,
      heap_used_bytes: mem.heapUsed,
    },
  };
}

export interface MetricsSeed {
  /** Aggregate task/spend history, from `activityStore.getPulse()`. */
  pulse?: {
    total_tasks: number;
    total_completed: number;
    total_failed: number;
    active_tasks: number;
    total_spent_usdc: number;
  };
  /** Persisted task results, from `getAllTaskResults()`. */
  taskResults?: Array<{
    steps: Array<{ success: boolean; error: string | null; latency_ms: number }>;
  }>;
}

/**
 * Seed counters from persisted state at startup.
 *
 * Tasks the activity log still shows as active belong to a process that has
 * since exited, so they are counted as `interrupted` rather than `active` —
 * nothing is in flight in a freshly started process. Step durations are seeded
 * from stored results so percentiles are meaningful before the first new task
 * runs.
 */
export function seedMetrics(seed: MetricsSeed): void {
  const { pulse, taskResults } = seed;

  if (pulse) {
    counters.tasks_total += pulse.total_tasks;
    counters.tasks_completed += pulse.total_completed;
    counters.tasks_failed += pulse.total_failed;
    counters.tasks_interrupted += pulse.active_tasks;
    counters.usdc_released_total += pulse.total_spent_usdc;
  }

  for (const result of taskResults ?? []) {
    for (const step of result.steps ?? []) {
      if (step.success) counters.steps_executed++;
      else {
        counters.steps_executed++;
        counters.steps_failed++;
        if (isTimeoutError(step.error)) counters.steps_timed_out++;
      }
      recordDuration(step.latency_ms);
    }
  }
}

/** Reset every counter. Test-only. */
export function resetMetrics(): void {
  counters = emptyCounters();
  activeTasks = new Set();
  durationSamples = [];
  durationCursor = 0;
  startedAt = Date.now();
}
