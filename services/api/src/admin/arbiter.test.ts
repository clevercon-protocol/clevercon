import { describe, it, expect, vi, afterEach } from 'vitest';
import { proposeDisputeSplit, fallbackProposal, type ArbiterContext } from './arbiter.js';

const base: ArbiterContext = {
  reason: 'The report was incomplete',
  providerResponse: null,
  budgetUsdc: 0.1,
  spentUsdc: 0,
  remainderUsdc: 0.1,
  steps: [
    {
      action: 'Research report',
      status: 'AWAITING_APPROVAL',
      priceUsdc: 0.1,
      owedUsdc: 0.06,
      milestones: [
        { title: 'Sources cited', status: 'accepted', amountUsdc: 0.06 },
        { title: 'Executive summary', status: 'rejected', amountUsdc: 0.04 },
      ],
    },
  ],
};

describe('fallbackProposal', () => {
  it('pays accepted milestones and refunds the rest, summing to the remainder', () => {
    const p = fallbackProposal(base);
    expect(p.payoutToProvider).toBe(0.06);
    expect(p.refundToUser).toBe(0.04);
    expect(p.payoutToProvider + p.refundToUser).toBeCloseTo(base.remainderUsdc, 7);
    expect(p.source).toBe('fallback');
  });

  it('defaults to a full buyer refund when nothing was judged', () => {
    const p = fallbackProposal({
      ...base,
      steps: [{ ...base.steps[0], milestones: null, owedUsdc: 0.1 }],
    });
    expect(p.refundToUser).toBe(0.1);
    expect(p.payoutToProvider).toBe(0);
  });

  it('never proposes a payout above the remainder', () => {
    const p = fallbackProposal({
      ...base,
      remainderUsdc: 0.03, // most already paid out; only 0.03 still locked
    });
    expect(p.payoutToProvider).toBeLessThanOrEqual(0.03);
    expect(p.payoutToProvider + p.refundToUser).toBeCloseTo(0.03, 7);
  });
});

describe('proposeDisputeSplit', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('uses the fallback when no API key is set (no network call)', async () => {
    const fetchImpl = vi.fn();
    const p = await proposeDisputeSplit({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(p.source).toBe('fallback');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the fallback when the remainder is zero (nothing to split)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn();
    const p = await proposeDisputeSplit({
      ...base,
      remainderUsdc: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(p.source).toBe('fallback');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clamps an LLM payout to the remainder and derives the refund', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                name: 'propose_resolution',
                input: {
                  // Over-remainder payout + an inconsistent refund: must be corrected.
                  payoutToProvider: 999,
                  refundToUser: 999,
                  reasoning: 'provider delivered everything',
                  confidence: 'high',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const p = await proposeDisputeSplit({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(p.source).toBe('llm');
    expect(p.payoutToProvider).toBe(0.1);
    expect(p.refundToUser).toBe(0);
    expect(p.confidence).toBe('high');
  });

  it('falls back on a non-2xx response', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const p = await proposeDisputeSplit({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(p.source).toBe('fallback');
  });
});
