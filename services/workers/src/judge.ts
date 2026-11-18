import { logger } from './logger.js';

/**
 * Advisory LLM quality judge for Tier-2 (Attestable) deliveries. During the
 * dispute window it scores how well a provider's OUTPUT fulfils the request,
 * giving the buyer a signal while they decide whether to approve or dispute.
 *
 * It is ADVISORY ONLY: it never gates a payment, never auto-releases, and never
 * auto-disputes. A trustless check is Tier-1's job (verifyDelivery); this is a
 * soft second opinion for the human-in-the-loop tier. Best-effort by design:
 * with no ANTHROPIC_API_KEY, or on any error/timeout, it returns null and the
 * step is simply left unscored.
 */

export interface JudgeVerdict {
  /** 0 (unusable) to 5 (fully correct and complete). */
  rating: number;
  /** One-line rationale, trimmed. */
  note: string;
}

export interface JudgeInput {
  /** The service's stated purpose (the rubric basis). */
  description: string;
  /** The capability/action the buyer invoked. */
  action: string;
  /** The buyer's job input. */
  input: unknown;
  /** The provider's returned output. */
  output: unknown;
  /** Optional explicit rubric to score against (overrides the description hint). */
  rubric?: string;
  fetchImpl?: typeof fetch;
}

const JUDGE_TIMEOUT_MS = 12_000;
const MAX_FIELD_CHARS = 4_000;

/** Compact, bounded stringification so the prompt stays small and cheap. */
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

const SYSTEM_PROMPT =
  'You are a strict quality auditor for an AI agent marketplace. Score how well ' +
  'the delivered OUTPUT fulfils the buyer REQUEST for the described service. ' +
  '0 = unusable, irrelevant, or wrong; 3 = acceptable but incomplete; 5 = fully ' +
  'correct, complete, and well-formed. Be skeptical: do not reward verbosity, ' +
  'confident tone, or restating the request. Judge substance only. Always call ' +
  'the score_delivery tool.';

/**
 * Score a delivery. Returns null when judging is disabled (no API key) or on any
 * failure, so callers treat it as a pure best-effort annotation.
 */
export async function judgeDelivery(params: JudgeInput): Promise<JudgeVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.LLM_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001';
  const fetchImpl = params.fetchImpl ?? fetch;

  const userContent = [
    `SERVICE: ${clip(params.description)}`,
    params.rubric ? `RUBRIC: ${clip(params.rubric)}` : '',
    `ACTION: ${clip(params.action)}`,
    `REQUEST INPUT:\n${clip(params.input)}`,
    `DELIVERED OUTPUT:\n${clip(params.output)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

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
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        tools: [
          {
            name: 'score_delivery',
            description: 'Record the quality score and a one-line rationale.',
            input_schema: {
              type: 'object',
              properties: {
                rating: {
                  type: 'number',
                  description: '0 to 5; how well the output fulfils the request.',
                },
                note: { type: 'string', description: 'One concise sentence of rationale.' },
              },
              required: ['rating', 'note'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'score_delivery' },
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'llm-judge call failed');
      return null;
    }
    const body = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const block = body.content?.find((b) => b.type === 'tool_use' && b.name === 'score_delivery');
    const input = block?.input as { rating?: unknown; note?: unknown } | undefined;
    if (!input || typeof input.rating !== 'number') return null;
    const rating = Math.max(0, Math.min(5, input.rating));
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 400) : '';
    return { rating: Math.round(rating * 10) / 10, note };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'llm-judge errored');
    return null;
  }
}
