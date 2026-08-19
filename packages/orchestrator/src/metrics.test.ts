import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMetrics,
  resetMetrics,
  seedMetrics,
  stepExecuted,
  stepFailed,
  taskCompleted,
  taskFailed,
  taskStarted,
  usdcReleased,
  isTimeoutError,
} from './metrics.js';

beforeEach(() => {
  resetMetrics();
});

describe('task counters', () => {
  it('starts at zero', () => {
    const m = getMetrics();
    expect(m.tasks).toEqual({ total: 0, active: 0, completed: 0, failed: 0, interrupted: 0 });
    expect(m.steps).toEqual({ executed: 0, failed: 0, timed_out: 0 });
    expect(m.usdc_released_total).toBe(0);
  });

  it('moves a task from active to completed', () => {
    taskStarted('t1');
    expect(getMetrics().tasks).toMatchObject({ total: 1, active: 1, completed: 0 });

    taskCompleted('t1');
    expect(getMetrics().tasks).toMatchObject({ total: 1, active: 0, completed: 1, failed: 0 });
  });

  it('moves a failed task out of active, not into both', () => {
    taskStarted('t1');
    taskFailed('t1');

    const m = getMetrics();
    expect(m.tasks.active).toBe(0);
    expect(m.tasks.failed).toBe(1);
    expect(m.tasks.completed).toBe(0);
  });

  it('is idempotent on repeated terminal transitions', () => {
    taskStarted('t1');
    taskFailed('t1');
    taskFailed('t1');
    taskCompleted('t1');

    const m = getMetrics();
    expect(m.tasks).toMatchObject({ total: 1, active: 0, failed: 1, completed: 0 });
  });

  it('ignores a terminal transition for a task that never started', () => {
    taskCompleted('never-seen');
    expect(getMetrics().tasks).toMatchObject({ total: 0, completed: 0 });
  });

  it('does not double-count a repeated start', () => {
    taskStarted('t1');
    taskStarted('t1');
    expect(getMetrics().tasks).toMatchObject({ total: 1, active: 1 });
  });

  it('tracks concurrent tasks independently', () => {
    taskStarted('a');
    taskStarted('b');
    taskStarted('c');
    expect(getMetrics().tasks.active).toBe(3);

    taskCompleted('b');
    const m = getMetrics();
    expect(m.tasks).toMatchObject({ total: 3, active: 2, completed: 1 });
  });

  it('keeps counts correct when terminal transitions interleave out of order', async () => {
    taskStarted('a');
    taskStarted('b');

    await Promise.all([
      (async () => {
        await Promise.resolve();
        taskFailed('b');
      })(),
      (async () => {
        taskCompleted('a');
      })(),
    ]);

    expect(getMetrics().tasks).toMatchObject({ total: 2, active: 0, completed: 1, failed: 1 });
  });
});

describe('step counters', () => {
  it('counts successes toward executed only', () => {
    stepExecuted(100);
    stepExecuted(200);
    expect(getMetrics().steps).toEqual({ executed: 2, failed: 0, timed_out: 0 });
  });

  it('counts failures toward executed and failed', () => {
    stepExecuted(100);
    stepFailed('Agent health check failed: http://x/health', 50);
    expect(getMetrics().steps).toEqual({ executed: 2, failed: 1, timed_out: 0 });
  });

  it('classifies timeout errors as a subset of failures', () => {
    stepFailed('The operation was aborted due to timeout', 15000);
    stepFailed('Request timed out', 15000);
    stepFailed('Agent not found: agent-x', 1);

    expect(getMetrics().steps).toEqual({ executed: 3, failed: 3, timed_out: 2 });
  });

  it('recognises timeout phrasings without false positives', () => {
    expect(isTimeoutError('TimeoutError: signal timed out')).toBe(true);
    expect(isTimeoutError('operation was aborted')).toBe(true);
    expect(isTimeoutError('timed-out waiting for agent')).toBe(true);
    expect(isTimeoutError('Vault release failed for step 2')).toBe(false);
    expect(isTimeoutError('')).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe('usdc released', () => {
  it('accumulates released payments', () => {
    usdcReleased(0.02);
    usdcReleased(0.03);
    usdcReleased(0.02);
    expect(getMetrics().usdc_released_total).toBe(0.07);
  });

  it('ignores non-positive and non-finite amounts', () => {
    usdcReleased(0);
    usdcReleased(-1);
    usdcReleased(Number.NaN);
    expect(getMetrics().usdc_released_total).toBe(0);
  });
});

describe('step duration summary', () => {
  it('reports nulls when no steps have run', () => {
    expect(getMetrics().step_duration_ms).toEqual({
      count: 0,
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
    });
  });

  it('computes p50, p95 and max over recorded samples', () => {
    for (let i = 1; i <= 100; i++) stepExecuted(i);

    const summary = getMetrics().step_duration_ms;
    expect(summary.count).toBe(100);
    expect(summary.p50_ms).toBe(50);
    expect(summary.p95_ms).toBe(95);
    expect(summary.max_ms).toBe(100);
  });

  it('includes failed-step durations', () => {
    stepExecuted(10);
    stepFailed('boom', 90);
    expect(getMetrics().step_duration_ms).toMatchObject({ count: 2, max_ms: 90 });
  });

  it('bounds memory at the ring capacity while executed keeps counting', () => {
    for (let i = 0; i < 5000; i++) stepExecuted(i);

    const m = getMetrics();
    expect(m.steps.executed).toBe(5000);
    expect(m.step_duration_ms.count).toBe(1024);
    // The ring retains the most recent samples, so early values are gone
    expect(m.step_duration_ms.max_ms).toBe(4999);
    expect(m.step_duration_ms.p50_ms).toBeGreaterThan(4000);
  });

  it('ignores negative durations', () => {
    stepExecuted(-5);
    expect(getMetrics().step_duration_ms.count).toBe(0);
  });
});

describe('uptime and memory', () => {
  it('reports a non-negative uptime and real memory readings', () => {
    const m = getMetrics();
    expect(m.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(m.memory.rss_bytes).toBeGreaterThan(0);
    expect(m.memory.heap_used_bytes).toBeGreaterThan(0);
  });
});

describe('seedMetrics', () => {
  it('restores task totals and spend from the activity pulse', () => {
    seedMetrics({
      pulse: {
        total_tasks: 10,
        total_completed: 7,
        total_failed: 2,
        active_tasks: 1,
        total_spent_usdc: 0.35,
      },
    });

    const m = getMetrics();
    expect(m.tasks).toEqual({
      total: 10,
      active: 0,
      completed: 7,
      failed: 2,
      interrupted: 1,
    });
    expect(m.usdc_released_total).toBe(0.35);
  });

  it('counts tasks in flight at shutdown as interrupted, never active', () => {
    seedMetrics({
      pulse: {
        total_tasks: 3,
        total_completed: 1,
        total_failed: 0,
        active_tasks: 2,
        total_spent_usdc: 0,
      },
    });

    expect(getMetrics().tasks.active).toBe(0);
    expect(getMetrics().tasks.interrupted).toBe(2);
  });

  it('seeds step counters and durations from stored task results', () => {
    seedMetrics({
      taskResults: [
        {
          steps: [
            { success: true, error: null, latency_ms: 100 },
            { success: false, error: 'signal timed out', latency_ms: 15000 },
          ],
        },
        {
          steps: [{ success: false, error: 'Agent not found: x', latency_ms: 5 }],
        },
      ],
    });

    const m = getMetrics();
    expect(m.steps).toEqual({ executed: 3, failed: 2, timed_out: 1 });
    expect(m.step_duration_ms).toMatchObject({ count: 3, max_ms: 15000 });
  });

  it('adds to live counters rather than replacing them', () => {
    taskStarted('live');
    taskCompleted('live');

    seedMetrics({
      pulse: {
        total_tasks: 4,
        total_completed: 4,
        total_failed: 0,
        active_tasks: 0,
        total_spent_usdc: 0.1,
      },
    });

    expect(getMetrics().tasks).toMatchObject({ total: 5, completed: 5 });
  });

  it('tolerates an empty seed', () => {
    expect(() => seedMetrics({})).not.toThrow();
    expect(getMetrics().tasks.total).toBe(0);
  });
});
