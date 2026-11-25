/**
 * AI first-pass dispute arbiter (decision #2/#3 of the endgame). Given a dispute's
 * context - the buyer's reason, the provider's response, what was delivered, the
 * acceptance milestones and their judged status, and the still-locked remainder - it
 * PROPOSES a fair split of the remainder between a refund to the buyer and a payout to
 * the provider, with reasoning. It NEVER moves money: a human operator reviews the
 * proposal and confirms the on-chain resolve_dispute.
 *
 * Best-effort: with no ANTHROPIC_API_KEY, or on any error, it falls back to a
 * deterministic, accepted-milestone-aware heuristic flagged low-confidence, so the
 * operator always gets a sensible starting point to review.
 */

const ROUND = 1e7;
const round7 = (n: number): number => Math.round(n * ROUND) / ROUND;
const ARBITER_TIMEOUT_MS = 15_000;
const MAX_FIELD_CHARS = 2_000;

export interface ArbiterStep {
  action: string;
  status: string;
  priceUsdc: number;
  owedUsdc: number;
  milestones: { title: string; status: string; amountUsdc: number }[] | null;
  outputSnippet?: string | null;
}

export interface ArbiterContext {
  reason: string | null;
  providerResponse: string | null;
  budgetUsdc: number;
  spentUsdc: number;
  /** The still-locked amount a resolution splits: refund + payout must equal this. */
  remainderUsdc: number;
  steps: ArbiterStep[];
  fetchImpl?: typeof fetch;
}

export interface ArbiterProposal {
  refundToUser: number;
  payoutToProvider: number;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'llm' | 'fallback';
}

function clip(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = s ?? '';
  return s.length > MAX_FIELD_CHARS ? `${s.slice(0, MAX_FIELD_CHARS)}…(truncated)` : s;
}

/** Whether a step's milestones have been judged (at least one accepted or rejected). */
function decided(s: ArbiterStep): boolean {
  return !!s.milestones?.some((m) => m.status === 'accepted' || m.status === 'rejected');
}

/**
 * Deterministic fallback: pay the provider for accepted milestones only (bounded by the
 * remainder), refund the rest. With no acceptance signal at all, default to a full buyer
 * refund - the conservative choice - and flag it for human review. Always low-confidence.
 */
export function fallbackProposal(ctx: ArbiterContext): ArbiterProposal {
  const remainder = round7(Math.max(0, ctx.remainderUsdc));
  let payout = 0;
  let anyDecided = false;
  for (const s of ctx.steps) {
    if (decided(s)) {
      anyDecided = true;
      payout += (s.milestones ?? [])
        .filter((m) => m.status === 'accepted')
        .reduce((a, m) => a + Math.max(0, Number(m.amountUsdc) || 0), 0);
    }
  }
  const payoutToProvider = Math.min(remainder, round7(payout));
  const refundToUser = round7(remainder - payoutToProvider);
  return {
    refundToUser,
    payoutToProvider,
    reasoning: anyDecided
      ? 'Heuristic split: pay the provider for accepted milestones only and refund the buyer the rest. Review the delivery before confirming.'
      : 'No acceptance signal (the milestones were not judged). Defaulting to a full buyer refund pending your review; adjust if the delivery warrants a payout.',
    confidence: 'low',
    source: 'fallback',
  };
}

const SYSTEM_PROMPT =
  'You are a neutral first-pass arbiter for an AI agent marketplace. A buyer hired a ' +
  'provider, the work was delivered, and the buyer opened a DISPUTE. Decide how to split ' +
  'the still-locked REMAINDER between a refund to the buyer and a payout to the provider. ' +
  'Be fair and evidence-based: weigh what was actually delivered against the agreed ' +
  'acceptance milestones and their judged status, the buyer reason, and the provider ' +
  'response. Pay for genuinely delivered, accepted work; refund for work not delivered or ' +
  'not meeting its criteria. The two amounts MUST sum to the remainder. Always call ' +
  'propose_resolution. You only propose; a human confirms, so give clear reasoning.';

/**
 * Propose a dispute resolution. Returns the LLM split (clamped so it sums to the
 * remainder) or the deterministic fallback when the LLM is unavailable or fails.
 */
export async function proposeDisputeSplit(ctx: ArbiterContext): Promise<ArbiterProposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const remainder = round7(Math.max(0, ctx.remainderUsdc));
  if (!apiKey || remainder <= 0) return fallbackProposal(ctx);
  const model = process.env.LLM_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001';
  const fetchImpl = ctx.fetchImpl ?? fetch;

  const stepLines = ctx.steps
    .map((s, i) => {
      const ms = s.milestones?.length
        ? ' Milestones: ' +
          s.milestones.map((m) => `[${m.status}] ${m.title} ($${m.amountUsdc})`).join('; ')
        : '';
      const out = s.outputSnippet ? ` Delivered: ${clip(s.outputSnippet)}` : '';
      return `${i + 1}. ${s.action} (status ${s.status}, price $${s.priceUsdc}, owed $${s.owedUsdc}).${ms}${out}`;
    })
    .join('\n');

  const userContent = [
    `REMAINDER TO SPLIT (USDC): ${remainder}`,
    `BUDGET: ${ctx.budgetUsdc}  SPENT (already paid): ${ctx.spentUsdc}`,
    `BUYER DISPUTE REASON: ${clip(ctx.reason ?? '(none given)')}`,
    `PROVIDER RESPONSE: ${clip(ctx.providerResponse ?? '(none given)')}`,
    `STEPS:\n${stepLines || '(none)'}`,
  ].join('\n\n');

  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        tools: [
          {
            name: 'propose_resolution',
            description: 'Record the proposed refund/payout split and the reasoning.',
            input_schema: {
              type: 'object',
              properties: {
                refundToUser: { type: 'number', description: 'USDC refunded to the buyer.' },
                payoutToProvider: { type: 'number', description: 'USDC paid to the provider.' },
                reasoning: {
                  type: 'string',
                  description: 'Why this split is fair (2-4 sentences).',
                },
                confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
              required: ['refundToUser', 'payoutToProvider', 'reasoning', 'confidence'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'propose_resolution' },
      }),
      signal: AbortSignal.timeout(ARBITER_TIMEOUT_MS),
    });
    if (!res.ok) return fallbackProposal(ctx);
    const body = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const block = body.content?.find(
      (b) => b.type === 'tool_use' && b.name === 'propose_resolution',
    );
    const input = block?.input as
      | { payoutToProvider?: unknown; reasoning?: unknown; confidence?: unknown }
      | undefined;
    if (!input || typeof input.payoutToProvider !== 'number') return fallbackProposal(ctx);
    // Clamp the payout and DERIVE the refund so the two always sum to the remainder,
    // regardless of what the model returned (the vault enforces this invariant too).
    const payoutToProvider = round7(Math.max(0, Math.min(remainder, input.payoutToProvider)));
    const refundToUser = round7(remainder - payoutToProvider);
    const confidence =
      input.confidence === 'high' || input.confidence === 'medium' ? input.confidence : 'low';
    const reasoning =
      typeof input.reasoning === 'string' && input.reasoning.trim()
        ? input.reasoning.trim().slice(0, 1000)
        : 'No reasoning returned.';
    return { refundToUser, payoutToProvider, reasoning, confidence, source: 'llm' };
  } catch {
    return fallbackProposal(ctx);
  }
}
