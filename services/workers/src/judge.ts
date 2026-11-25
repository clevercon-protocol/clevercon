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

/** One acceptance milestone to score (its id so the verdict maps back, + the rubric). */
export interface MilestoneJudgeItem {
  id: string;
  title: string;
  criteria?: string;
}

/** Per-milestone verdict: whether the delivery met it, a 0-5 score, and a rationale. */
export interface MilestoneVerdict {
  id: string;
  met: boolean;
  score: number;
  note: string;
}

export interface MilestoneJudgeInput extends Omit<JudgeInput, 'rubric'> {
  milestones: MilestoneJudgeItem[];
}

const MILESTONE_SYSTEM_PROMPT =
  'You are a strict acceptance auditor for an AI agent marketplace. A buyer hired a ' +
  'provider and agreed a list of acceptance MILESTONES, each with its own criteria. ' +
  'Judge the delivered OUTPUT against EACH milestone independently. For each, decide ' +
  'if it is met (met=true only when the criteria are genuinely satisfied by the ' +
  'substance of the output), a 0-5 score (0 = not addressed, 3 = partially, 5 = fully ' +
  'satisfied), and one concise sentence of rationale. Be skeptical: do not reward ' +
  'verbosity or restating the request. Always call the score_milestones tool and ' +
  'return exactly one result per milestone, by its index.';

/**
 * Score each acceptance milestone of a judged hire against the delivery. Advisory in
 * P1 (surfaced to the buyer, never gates payment yet). Returns null when judging is
 * disabled (no API key / no milestones) or on any failure; the milestones stay pending.
 */
export async function judgeMilestones(
  params: MilestoneJudgeInput,
): Promise<MilestoneVerdict[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || params.milestones.length === 0) return null;
  const model = process.env.LLM_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001';
  const fetchImpl = params.fetchImpl ?? fetch;

  const list = params.milestones
    .map((m, i) => `${i}. ${m.title}${m.criteria ? ` - ${m.criteria}` : ''}`)
    .join('\n');
  const userContent = [
    `SERVICE: ${clip(params.description)}`,
    `ACTION: ${clip(params.action)}`,
    `REQUEST INPUT:\n${clip(params.input)}`,
    `DELIVERED OUTPUT:\n${clip(params.output)}`,
    `MILESTONES (score each by its leading index):\n${list}`,
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
        max_tokens: 600,
        system: MILESTONE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        tools: [
          {
            name: 'score_milestones',
            description: 'Record a met/score/note verdict for every milestone, by index.',
            input_schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      index: { type: 'number', description: 'The milestone index scored.' },
                      met: { type: 'boolean', description: 'Whether the output meets it.' },
                      score: { type: 'number', description: '0 to 5.' },
                      note: { type: 'string', description: 'One concise sentence.' },
                    },
                    required: ['index', 'met', 'score', 'note'],
                  },
                },
              },
              required: ['results'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'score_milestones' },
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'llm-milestone-judge call failed');
      return null;
    }
    const body = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const block = body.content?.find((b) => b.type === 'tool_use' && b.name === 'score_milestones');
    const results = (block?.input as { results?: unknown } | undefined)?.results;
    if (!Array.isArray(results)) return null;
    // Map each returned verdict back to its milestone by index; unmatched stay absent.
    const byIndex = new Map<number, { met: boolean; score: number; note: string }>();
    for (const r of results) {
      const row = r as { index?: unknown; met?: unknown; score?: unknown; note?: unknown };
      const i = typeof row.index === 'number' ? row.index : NaN;
      if (!Number.isInteger(i) || i < 0 || i >= params.milestones.length) continue;
      const score = typeof row.score === 'number' ? Math.max(0, Math.min(5, row.score)) : 0;
      byIndex.set(i, {
        met: row.met === true,
        score: Math.round(score * 10) / 10,
        note: typeof row.note === 'string' ? row.note.trim().slice(0, 400) : '',
      });
    }
    const verdicts: MilestoneVerdict[] = [];
    params.milestones.forEach((m, i) => {
      const v = byIndex.get(i);
      if (v) verdicts.push({ id: m.id, ...v });
    });
    return verdicts.length ? verdicts : null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'llm-milestone-judge errored',
    );
    return null;
  }
}
