import { describe, it, expect, vi, afterEach } from 'vitest';
import { judgeDelivery, judgeMilestones } from './judge.js';

function toolUseResponse(rating: unknown, note: unknown) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', name: 'score_delivery', input: { rating, note } }],
        }),
        { status: 200 },
      ),
  );
}

const baseInput = {
  description: 'Returns the current XLM/USD price',
  action: 'price',
  input: { pair: 'XLM/USD' },
  output: { price: '0.11' },
};

describe('judgeDelivery', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_JUDGE_MODEL;
  });

  it('returns null (disabled) without an API key', async () => {
    const fetchImpl = vi.fn();
    const res = await judgeDelivery({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses a tool_use verdict and rounds the rating', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = toolUseResponse(4.25, '  solid, matches the request  ');
    const res = await judgeDelivery({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ rating: 4.3, note: 'solid, matches the request' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('clamps an out-of-range rating into 0..5', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = toolUseResponse(9, 'too high');
    const res = await judgeDelivery({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res?.rating).toBe(5);
  });

  it('returns null on a non-2xx response', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 429 }));
    const res = await judgeDelivery({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it('returns null when the response has no tool_use block', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }), { status: 200 }),
    );
    const res = await judgeDelivery({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });
});

function milestoneToolResponse(results: unknown) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', name: 'score_milestones', input: { results } }],
        }),
        { status: 200 },
      ),
  );
}

const milestones = [
  { id: 'm1', title: 'Fetches the price' },
  { id: 'm2', title: 'Formats to 2 decimals', criteria: 'e.g. 0.11' },
];

describe('judgeMilestones', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null (disabled) without an API key', async () => {
    const fetchImpl = vi.fn();
    const res = await judgeMilestones({
      ...baseInput,
      milestones,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null for an empty milestone list (no call)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn();
    const res = await judgeMilestones({
      ...baseInput,
      milestones: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps each verdict back to its milestone id, clamps and rounds the score', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = milestoneToolResponse([
      { index: 0, met: true, score: 4.75, note: '  got the price  ' },
      { index: 1, met: false, score: 9, note: 'wrong format' },
    ]);
    const res = await judgeMilestones({
      ...baseInput,
      milestones,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual([
      { id: 'm1', met: true, score: 4.8, note: 'got the price' },
      { id: 'm2', met: false, score: 5, note: 'wrong format' },
    ]);
  });

  it('ignores out-of-range indices and keeps only matched milestones', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = milestoneToolResponse([
      { index: 1, met: true, score: 5, note: 'ok' },
      { index: 7, met: true, score: 5, note: 'phantom' },
    ]);
    const res = await judgeMilestones({
      ...baseInput,
      milestones,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual([{ id: 'm2', met: true, score: 5, note: 'ok' }]);
  });

  it('returns null when the tool returns no usable results', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = milestoneToolResponse('not-an-array');
    const res = await judgeMilestones({
      ...baseInput,
      milestones,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
  });
});
