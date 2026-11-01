import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeTask, isAcceptableOutput, releaseHeldStep, pollStep } from './executor.js';

interface Service {
  endpoint: string;
  tier?: string;
  verification?: { method: string; spec?: Record<string, unknown> } | null;
  outputSchema?: Record<string, unknown> | null;
}
interface Step {
  id: string;
  index: number;
  action: string;
  status: string;
  service: Service | null;
  serviceId?: string | null;
  input?: Record<string, unknown> | null;
  output?: string | null;
  error?: string | null;
  latencyMs?: number | null;
  releaseAt?: Date | null;
  qualityRating?: number | null;
  qualityNote?: string | null;
}
interface Task {
  id: string;
  status: string;
  steps: Step[];
}

// Minimal in-memory Prisma double capturing the writes the executor makes.
function mockPrisma(task: Task | null) {
  return {
    task: {
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        if (task) task.status = data.status;
        return task;
      }),
    },
    taskStep: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Step> }) => {
        const s = task?.steps.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const okFetch = vi.fn(async () => new Response('result-body', { status: 200 }));

describe('executeTask', () => {
  it('runs a reachable step and completes the task', async () => {
    const task: Task = {
      id: 't1',
      status: 'DRAFT',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'Pay oracle',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const p = mockPrisma(task);
    const res = await executeTask(p, okFetch as unknown as typeof fetch, 't1');
    expect(res.status).toBe('completed');
    expect(task.status).toBe('COMPLETED');
    expect(task.steps[0].status).toBe('RELEASED');
    expect(task.steps[0].output).toBe('result-body');
    expect(task.steps[0].latencyMs).toBeTypeOf('number');
  });

  it('fails the step (and task) when the provider errors', async () => {
    const task: Task = {
      id: 't2',
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const badFetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const res = await executeTask(mockPrisma(task), badFetch as unknown as typeof fetch, 't2');
    expect(res.status).toBe('failed');
    expect(task.status).toBe('FAILED');
    expect(task.steps[0].status).toBe('FAILED');
    expect(task.steps[0].error).toContain('HTTP 500');
  });

  it('fails a step with no provider endpoint', async () => {
    const task: Task = {
      id: 't3',
      status: 'PENDING',
      steps: [{ id: 's1', index: 0, action: 'x', status: 'PENDING', service: null }],
    };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't3');
    expect(res.status).toBe('failed');
    expect(task.steps[0].error).toBe('no provider endpoint');
  });

  it('is idempotent: already-released steps are skipped', async () => {
    const task: Task = {
      id: 't4',
      status: 'RUNNING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'RELEASED',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const spy = vi.fn(async () => new Response('x', { status: 200 }));
    const res = await executeTask(mockPrisma(task), spy as unknown as typeof fetch, 't4');
    expect(res.status).toBe('completed');
    expect(spy).not.toHaveBeenCalled(); // released step not re-executed
  });

  it('skips a terminal task', async () => {
    const task: Task = { id: 't5', status: 'COMPLETED', steps: [] };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't5');
    expect(res.status).toBe('skipped');
  });

  it('skips a missing task', async () => {
    const res = await executeTask(mockPrisma(null), okFetch as unknown as typeof fetch, 'nope');
    expect(res.status).toBe('skipped');
  });

  it('fails a step whose 2xx output does not pass the acceptance check', async () => {
    const task: Task = {
      id: 't6',
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    // A 200 with a soft-error JSON body is a non-delivery: do not pay for it.
    const softError = vi.fn(
      async () => new Response(JSON.stringify({ error: 'no data' }), { status: 200 }),
    );
    const res = await executeTask(mockPrisma(task), softError as unknown as typeof fetch, 't6');
    expect(res.status).toBe('failed');
    expect(task.steps[0].status).toBe('FAILED');
    expect(task.steps[0].error).toContain('acceptance');
  });

  function oneStep(id: string, service: Service, input: Record<string, unknown> = {}): Task {
    return {
      id,
      status: 'PENDING',
      steps: [{ id: 's1', index: 0, action: 'x', status: 'PENDING', service, input }],
    };
  }

  it('fails a step whose result violates the service output schema', async () => {
    const task = oneStep('t7', {
      endpoint: 'https://svc.test',
      outputSchema: { type: 'object', required: ['price'] },
    });
    const bad = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    const res = await executeTask(mockPrisma(task), bad as unknown as typeof fetch, 't7');
    expect(res.status).toBe('failed');
    expect(task.steps[0].error).toContain('schema');
  });

  it('releases a T1 step when the witness verifier passes and fails it when it does not', async () => {
    const service: Service = {
      endpoint: 'https://svc.test',
      tier: 'T1',
      verification: { method: 'witness', spec: { predicate: 'product' } },
    };
    // Correct factors for n=15: an envelope the worker re-checks trustlessly.
    const good = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, contentType: 'application/json', data: { a: 3, b: 5 }, issuedAt: 1 }),
          { status: 200 },
        ),
    );
    const passTask = oneStep('t8', service, { n: 15 });
    expect((await executeTask(mockPrisma(passTask), good as unknown as typeof fetch, 't8')).status).toBe(
      'completed',
    );
    expect(passTask.steps[0].status).toBe('RELEASED');

    const bad = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, contentType: 'application/json', data: { a: 3, b: 4 }, issuedAt: 1 }),
          { status: 200 },
        ),
    );
    const failTask = oneStep('t9', service, { n: 15 });
    expect((await executeTask(mockPrisma(failTask), bad as unknown as typeof fetch, 't9')).status).toBe(
      'failed',
    );
    expect(failTask.steps[0].error).toContain('verification');
  });
});

describe('executeTask T2 dispute window', () => {
  afterEach(() => {
    delete process.env.DISPUTE_WINDOW_SECONDS;
  });

  function t2Task(id: string): Task {
    return {
      id,
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          serviceId: 'svc1',
          service: { endpoint: 'https://svc.test', tier: 'T2' },
        },
      ],
    };
  }

  it('holds an accepted T2 step for the window instead of releasing it', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw1');
    const scheduleRelease = vi.fn(async () => {});
    const enqueueSettle = vi.fn(async () => {});
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw1', {
      scheduleRelease,
      enqueueSettle,
    });
    expect(res.status).toBe('awaiting');
    expect(task.status).toBe('RUNNING'); // not COMPLETED while held
    expect(task.steps[0].status).toBe('AWAITING_APPROVAL');
    expect(task.steps[0].releaseAt).toBeInstanceOf(Date);
    expect(scheduleRelease).toHaveBeenCalledWith('s1', 3600 * 1000);
    expect(enqueueSettle).not.toHaveBeenCalled(); // no release yet
  });

  it('releases a T2 step immediately when the window is disabled (0)', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '0';
    const task = t2Task('tw2');
    const scheduleRelease = vi.fn(async () => {});
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw2', {
      scheduleRelease,
    });
    expect(res.status).toBe('completed');
    expect(task.steps[0].status).toBe('RELEASED');
    expect(scheduleRelease).not.toHaveBeenCalled();
  });

  it('is idempotent: a held step is not re-executed on replay', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw3');
    task.status = 'RUNNING';
    task.steps[0].status = 'AWAITING_APPROVAL';
    const spy = vi.fn(async () => new Response('x', { status: 200 }));
    const res = await executeTask(mockPrisma(task), spy as unknown as typeof fetch, 'tw3', {
      scheduleRelease: vi.fn(async () => {}),
    });
    expect(res.status).toBe('awaiting');
    expect(spy).not.toHaveBeenCalled(); // provider not called again
  });

  it('annotates a held step with the advisory judge verdict', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw4');
    const judge = vi.fn(async () => ({ rating: 4.5, note: 'matches the request' }));
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw4', {
      scheduleRelease: vi.fn(async () => {}),
      judge,
    });
    expect(res.status).toBe('awaiting');
    expect(judge).toHaveBeenCalledOnce();
    expect(task.steps[0].qualityRating).toBe(4.5);
    expect(task.steps[0].qualityNote).toBe('matches the request');
  });

  it('holds normally when the judge is unavailable (returns null)', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw5');
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw5', {
      scheduleRelease: vi.fn(async () => {}),
      judge: vi.fn(async () => null),
    });
    expect(res.status).toBe('awaiting');
    expect(task.steps[0].status).toBe('AWAITING_APPROVAL');
    expect(task.steps[0].qualityRating ?? null).toBeNull();
  });

  it('holds a T3 step for human approval with no auto-release timer', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '0'; // T3 holds regardless of the window
    const task = t2Task('tw6');
    task.steps[0].service = { endpoint: 'https://svc.test', tier: 'T3' };
    const scheduleRelease = vi.fn(async () => {});
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw6', {
      scheduleRelease,
    });
    expect(res.status).toBe('awaiting');
    expect(task.status).toBe('RUNNING');
    expect(task.steps[0].status).toBe('AWAITING_APPROVAL');
    expect(task.steps[0].releaseAt ?? null).toBeNull(); // no timed release
    expect(scheduleRelease).not.toHaveBeenCalled(); // waits for the buyer
  });
});

interface HeldStep {
  id: string;
  status: string;
  serviceId?: string | null;
  task: { id: string; status: string; buyerId: string; vaultTaskId: string | null } | null;
}

function mockReleasePrisma(step: HeldStep | null, openDisputes = 0, stillOpen = 0) {
  const task = step?.task ?? null;
  return {
    taskStep: {
      findUnique: vi.fn(async () => step),
      update: vi.fn(async ({ data }: { data: Partial<HeldStep> }) => {
        if (step) Object.assign(step, data);
        return step;
      }),
      count: vi.fn(async () => stillOpen),
    },
    task: {
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        if (task) task.status = data.status;
        return task;
      }),
    },
    dispute: { count: vi.fn(async () => openDisputes) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('releaseHeldStep', () => {
  it('releases a held step and enqueues settlement when undisputed', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle });
    expect(res.status).toBe('released');
    expect(step.status).toBe('RELEASED');
    expect(enqueueSettle).toHaveBeenCalledWith('s1');
  });

  it('does not release while a dispute is open (window paused)', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step, 1), 's1', { enqueueSettle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('dispute open');
    expect(step.status).toBe('AWAITING_APPROVAL'); // untouched
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it('no-ops a step that was already released (approved early)', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'RELEASED',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle });
    expect(res.status).toBe('skipped');
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it('does not release on a disputed task', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'DISPUTED', buyerId: 'u1', vaultTaskId: '7' },
    };
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle: vi.fn() });
    expect(res.status).toBe('skipped');
    expect(step.status).toBe('AWAITING_APPROVAL');
  });

  it('completes an off-chain task (no vault) once no step is still open', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: null },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step, 0, 0), 's1', { enqueueSettle });
    expect(res.status).toBe('released');
    expect(step.status).toBe('RELEASED');
    expect(step.task?.status).toBe('COMPLETED');
    expect(enqueueSettle).not.toHaveBeenCalled(); // no on-chain settlement
  });
});

// ----- async / needs-input lifecycle -----

function envelopeResp(fields: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ ok: true, contentType: 'application/json', issuedAt: 1, ...fields }),
    { status: 200 },
  );
}
const workingResp = (handle = 'h1', progress?: object) =>
  envelopeResp({ status: 'working', handle, ...(progress ? { progress } : {}) });
const inputReqResp = (requestId = 'q1', prompt = 'Which format?') =>
  envelopeResp({ status: 'input_required', inputRequest: { requestId, prompt } });
const completedResp = (data: unknown = 'result') => envelopeResp({ status: 'completed', data });

describe('executeTask async lifecycle', () => {
  function oneAsync(id: string): Task {
    return {
      id,
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          serviceId: 'svc1',
          service: { endpoint: 'https://svc.test' },
          input: {},
        },
      ],
    };
  }

  it('parks a working step (RUNNING + handle) and schedules a poll; task stays RUNNING', async () => {
    const task = oneAsync('a1');
    const scheduleStepPoll = vi.fn(async () => {});
    const res = await executeTask(
      mockPrisma(task),
      (() => workingResp('h1', { pct: 10 })) as unknown as typeof fetch,
      'a1',
      { scheduleStepPoll },
    );
    expect(res.status).toBe('awaiting');
    expect(task.status).toBe('RUNNING');
    expect(task.steps[0].status).toBe('RUNNING');
    expect((task.steps[0] as { providerJobHandle?: string }).providerJobHandle).toBe('h1');
    expect(scheduleStepPoll).toHaveBeenCalledWith('s1', expect.any(Number));
  });

  it('parks an input_required step with the question and schedules a poll', async () => {
    const task = oneAsync('a2');
    const scheduleStepPoll = vi.fn(async () => {});
    const res = await executeTask(
      mockPrisma(task),
      (() => inputReqResp('q9', 'PNG or JPG?')) as unknown as typeof fetch,
      'a2',
      { scheduleStepPoll },
    );
    expect(res.status).toBe('awaiting');
    expect(task.steps[0].status).toBe('INPUT_REQUIRED');
    expect((task.steps[0] as { inputRequest?: { requestId: string } }).inputRequest).toMatchObject({
      requestId: 'q9',
    });
    expect(scheduleStepPoll).toHaveBeenCalled();
  });

  it('fails a working reply that omits a job handle', async () => {
    const task = oneAsync('a3');
    const res = await executeTask(
      mockPrisma(task),
      (() => envelopeResp({ status: 'working' })) as unknown as typeof fetch,
      'a3',
      { scheduleStepPoll: vi.fn(async () => {}) },
    );
    expect(res.status).toBe('failed');
    expect(task.steps[0].status).toBe('FAILED');
  });
});

interface PolledStep {
  id: string;
  index: number;
  action: string;
  status: string;
  serviceId?: string | null;
  providerJobHandle?: string | null;
  input?: Record<string, unknown> | null;
  inputRequest?: unknown;
  inputResponse?: unknown;
  createdAt: Date;
  service: { endpoint: string; tier?: string; outputSchema?: Record<string, unknown> | null } | null;
  task: { id: string; status: string; buyerId: string; vaultTaskId: bigint | null } | null;
}

function mockPollPrisma(step: PolledStep) {
  return {
    taskStep: {
      findUnique: vi.fn(async () => step),
      update: vi.fn(async ({ data }: { data: Partial<PolledStep> }) => {
        Object.assign(step, data);
        return step;
      }),
    },
    // recordOutcome's $transaction is intentionally absent: it throws inside its own
    // try/catch and is swallowed (reputation is best-effort), so polls stay hermetic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('pollStep', () => {
  function parked(over: Partial<PolledStep> = {}): PolledStep {
    return {
      id: 's1',
      index: 0,
      action: 'x',
      status: 'RUNNING',
      serviceId: 'svc1',
      providerJobHandle: 'h1',
      input: {},
      inputRequest: null,
      inputResponse: null,
      createdAt: new Date(),
      service: { endpoint: 'https://svc.test' },
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: null },
      ...over,
    };
  }

  it('completes a working step on poll (kind:poll + handle) and re-enqueues the task', async () => {
    const step = parked();
    const reEnqueueTask = vi.fn(async () => {});
    const fetchDone = vi.fn(async () => completedResp('done'));
    const res = await pollStep(mockPollPrisma(step), fetchDone as unknown as typeof fetch, 's1', {
      reEnqueueTask,
      scheduleStepPoll: vi.fn(async () => {}),
    });
    expect(res.status).toBe('completed');
    expect(step.status).toBe('RELEASED');
    expect(reEnqueueTask).toHaveBeenCalledWith('t1');
    const body = JSON.parse((fetchDone.mock.calls[0][1] as { body: string }).body);
    expect(body.kind).toBe('poll');
    expect(body.handle).toBe('h1');
  });

  it('keeps polling while the provider is still working', async () => {
    const step = parked();
    const scheduleStepPoll = vi.fn(async () => {});
    const res = await pollStep(
      mockPollPrisma(step),
      (() => workingResp('h1', { pct: 50 })) as unknown as typeof fetch,
      's1',
      { scheduleStepPoll, reEnqueueTask: vi.fn(async () => {}) },
    );
    expect(res.status).toBe('working');
    expect(step.status).toBe('RUNNING');
    expect(scheduleStepPoll).toHaveBeenCalled();
  });

  it('re-arms the deadline watch while awaiting an answer (no provider call)', async () => {
    const step = parked({
      status: 'INPUT_REQUIRED',
      inputRequest: { requestId: 'q1', prompt: 'fmt?' },
      inputResponse: null,
    });
    const scheduleStepPoll = vi.fn(async () => {});
    const spy = vi.fn(async () => completedResp());
    const res = await pollStep(mockPollPrisma(step), spy as unknown as typeof fetch, 's1', {
      scheduleStepPoll,
    });
    expect(res.status).toBe('input_required');
    expect(spy).not.toHaveBeenCalled();
    expect(scheduleStepPoll).toHaveBeenCalled();
  });

  it('relays a stored answer as kind:answer and completes', async () => {
    const step = parked({
      status: 'INPUT_REQUIRED',
      inputRequest: { requestId: 'q1', prompt: 'fmt?' },
      inputResponse: { format: 'png' },
    });
    const fetchDone = vi.fn(async () => completedResp('ok'));
    const res = await pollStep(mockPollPrisma(step), fetchDone as unknown as typeof fetch, 's1', {
      reEnqueueTask: vi.fn(async () => {}),
      scheduleStepPoll: vi.fn(async () => {}),
    });
    expect(res.status).toBe('completed');
    const body = JSON.parse((fetchDone.mock.calls[0][1] as { body: string }).body);
    expect(body.kind).toBe('answer');
    expect(body.requestId).toBe('q1');
    expect(body.inputResponse).toMatchObject({ format: 'png' });
  });

  it('fails the step when the provider reports failed', async () => {
    const step = parked();
    const reEnqueueTask = vi.fn(async () => {});
    const res = await pollStep(
      mockPollPrisma(step),
      (() => envelopeResp({ ok: false, status: 'failed', error: 'boom' })) as unknown as typeof fetch,
      's1',
      { reEnqueueTask, scheduleStepPoll: vi.fn(async () => {}) },
    );
    expect(res.status).toBe('failed');
    expect(step.status).toBe('FAILED');
    expect(reEnqueueTask).toHaveBeenCalledWith('t1');
  });

  it('fails a step that exceeds the max async duration (no provider call)', async () => {
    const step = parked({ createdAt: new Date(Date.now() - 2 * 3600 * 1000) });
    const spy = vi.fn(async () => completedResp());
    const res = await pollStep(mockPollPrisma(step), spy as unknown as typeof fetch, 's1', {
      reEnqueueTask: vi.fn(async () => {}),
      scheduleStepPoll: vi.fn(async () => {}),
    });
    expect(res.status).toBe('failed');
    expect(step.status).toBe('FAILED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays working (retries) on a transient provider HTTP error', async () => {
    const step = parked();
    const scheduleStepPoll = vi.fn(async () => {});
    const res = await pollStep(
      mockPollPrisma(step),
      (() => new Response('err', { status: 503 })) as unknown as typeof fetch,
      's1',
      { scheduleStepPoll, reEnqueueTask: vi.fn(async () => {}) },
    );
    expect(res.status).toBe('working');
    expect(step.status).toBe('RUNNING');
    expect(scheduleStepPoll).toHaveBeenCalled();
  });

  it('skips a step that is no longer awaiting a poll', async () => {
    const step = parked({ status: 'RELEASED' });
    const res = await pollStep(
      mockPollPrisma(step),
      (() => completedResp()) as unknown as typeof fetch,
      's1',
      {},
    );
    expect(res.status).toBe('skipped');
  });
});

describe('isAcceptableOutput', () => {
  it('accepts non-empty plain text and JSON without an error field', () => {
    expect(isAcceptableOutput('result-body')).toBe(true);
    expect(isAcceptableOutput(JSON.stringify({ price: '0.10' }))).toBe(true);
    expect(isAcceptableOutput(JSON.stringify({ error: null }))).toBe(true);
  });

  it('rejects empty output and a soft JSON error', () => {
    expect(isAcceptableOutput('')).toBe(false);
    expect(isAcceptableOutput('   ')).toBe(false);
    expect(isAcceptableOutput(JSON.stringify({ error: 'boom' }))).toBe(false);
  });
});
