import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultService } from '../vault/vault.service.js';

export interface PlanLine {
  payee: string;
  amount: number;
  reason?: string;
}

export interface AgentPlan {
  kind: 'pay' | 'disburse' | 'hire' | 'none';
  lines: PlanLine[];
  service: { id: string; name: string; pricePerCall: number } | null;
  budget: number;
  rationale: string;
  warnings: string[];
  source: 'llm' | 'fallback';
}

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;

// The structured shape the model must return. All fields required + no extras so
// the tool call is well-formed; the model fills empties where a field is N/A.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['pay', 'disburse', 'hire', 'none'],
      description:
        'pay = one address; disburse = many addresses; hire = pay a service; none = not a spend / unclear',
    },
    lines: {
      type: 'array',
      description: 'the payments (for pay/disburse). Empty for hire/none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payee: {
            type: 'string',
            description:
              'Stellar address (G...). Leave empty if the user gave a name, not an address.',
          },
          amount: { type: 'number', description: 'USDC amount, > 0' },
          reason: { type: 'string', description: 'what this payment is for (may be empty)' },
        },
        required: ['payee', 'amount', 'reason'],
      },
    },
    serviceQuery: {
      type: 'string',
      description: 'for hire: a few words describing the service to find; else empty',
    },
    budget: { type: 'number', description: 'for hire: max USDC to spend; else 0' },
    rationale: {
      type: 'string',
      description: 'one short sentence explaining the plan to the user',
    },
  },
  required: ['kind', 'lines', 'serviceQuery', 'budget', 'rationale'],
};

const SYSTEM_PROMPT =
  'You turn a user instruction into a spending plan for a non-custodial Stellar agent. ' +
  'The agent can pay one address, disburse to many, or hire a listed service. ' +
  'Only propose what the user actually asked for; never invent Stellar addresses. ' +
  'If the user names a person without an address, leave payee empty and put the name in reason. ' +
  'If the instruction is not a spend or is unclear, use kind "none" and explain in rationale. ' +
  'Amounts are USDC; use the available budget to stay realistic. ' +
  'You NEVER choose, read, or infer a spending rule: the human selects the rule the vault enforces, ' +
  'and private rules are not visible to you. Plan ONLY the actions (who/how much/which service).';
const TOOL_DESC = 'Return the structured spending plan for the user to review.';

type Provider = 'anthropic' | 'openai' | 'none';

interface RawPlan {
  kind: AgentPlan['kind'];
  lines: PlanLine[];
  serviceQuery: string;
  budget: number;
  rationale: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
  ) {}

  /**
   * Which LLM backs the planner. CleverCon is provider-agnostic: keep native
   * Anthropic as the default, but a single OpenAI-compatible adapter covers
   * OpenAI, Gemini (its OpenAI-compat endpoint), OpenRouter, and local models
   * (Ollama/vLLM) via OPENAI_BASE_URL. AGENT_PROVIDER forces one; 'auto' picks
   * whichever key is set; 'none' (or no key) uses the deterministic fallback.
   */
  private provider(): Provider {
    const pref = (process.env.AGENT_PROVIDER ?? 'auto').toLowerCase();
    if (pref === 'none') return 'none';
    if (pref === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none';
    if (pref === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : 'none';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'none';
  }

  /**
   * Parse a natural-language instruction into a structured, re-validated plan.
   * The model only PROPOSES; the human approves and the vault enforces limits,
   * so a bad or adversarial plan cannot move funds outside the caps. Falls back
   * to a deterministic parser when no API key is configured.
   */
  async plan(userId: string, instruction: string): Promise<AgentPlan> {
    const text = (instruction ?? '').trim();
    if (!text) {
      return {
        kind: 'none',
        lines: [],
        service: null,
        budget: 0,
        rationale: 'Tell me what to do with your budget.',
        warnings: [],
        source: 'fallback',
      };
    }

    const provider = this.provider();
    const raw =
      provider === 'none' ? fallbackParse(text) : await this.parseWithLlm(userId, text, provider);
    const available = await this.vault
      .getForUser(userId)
      .then((v) => v.available)
      .catch(() => 0);
    return this.validate(raw.plan, raw.source, available);
  }

  private async parseWithLlm(
    userId: string,
    instruction: string,
    provider: Provider,
  ): Promise<{ plan: RawPlan; source: AgentPlan['source'] }> {
    try {
      const context = await this.buildContext(userId);
      const input =
        provider === 'anthropic'
          ? await this.callAnthropic(instruction, context)
          : await this.callOpenAiCompatible(instruction, context);
      return { plan: normalizeRaw(input), source: 'llm' };
    } catch (err) {
      this.logger.warn(
        `LLM planning failed (${provider}), using fallback: ${(err as Error).message}`,
      );
      return fallbackParse(instruction);
    }
  }

  /** Native Anthropic (default). Forced tool-use gives a validated structured plan. */
  private async callAnthropic(instruction: string, context: string): Promise<unknown> {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      timeout: 30_000,
      maxRetries: 1,
    });
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Instruction: ${instruction}\n\n${context}` }],
      tools: [
        {
          name: 'propose_plan',
          description: TOOL_DESC,
          input_schema: PLAN_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'propose_plan' },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') throw new Error('no tool_use in response');
    return block.input;
  }

  /**
   * OpenAI-compatible chat completions with a forced function call. One adapter
   * for OpenAI, Gemini (OpenAI-compat), OpenRouter, and local servers: point
   * OPENAI_BASE_URL at the endpoint and set OPENAI_MODEL.
   */
  private async callOpenAiCompatible(instruction: string, context: string): Promise<unknown> {
    const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(
      /\/+$/,
      '',
    );
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Instruction: ${instruction}\n\n${context}` },
        ],
        tools: [
          {
            type: 'function',
            function: { name: 'propose_plan', description: TOOL_DESC, parameters: PLAN_SCHEMA },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'propose_plan' } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error('no function call in response');
    return JSON.parse(args);
  }

  private async buildContext(userId: string): Promise<string> {
    // The planner is deliberately NOT told about the user's rules. It only needs
    // the available budget (for realism) and the hireable services. The human
    // selects the rule the vault enforces; private rules never reach the model.
    const [vault, services] = await Promise.all([
      this.vault.getForUser(userId).catch(() => ({ available: 0 })),
      this.prisma.service.findMany({
        where: { status: 'ACTIVE' },
        select: { name: true, pricePerCall: true },
        take: 8,
      }),
    ]);
    const svc = services.map((s) => `- ${s.name} ($${Number(s.pricePerCall)}/call)`).join('\n');
    return [
      `Available budget: ${(vault as { available: number }).available} USDC.`,
      svc ? `Services you can hire:\n${svc}` : 'No services available.',
    ].join('\n\n');
  }

  /** Re-validate the proposed plan server-side (the model is never trusted). */
  private async validate(
    raw: RawPlan,
    source: AgentPlan['source'],
    available: number,
  ): Promise<AgentPlan> {
    const warnings: string[] = [];
    const lines = (raw.lines ?? [])
      .map((l) => ({
        payee: String(l.payee ?? '').trim(),
        amount: Number(l.amount),
        reason: String(l.reason ?? '').trim() || undefined,
      }))
      .filter((l) => {
        if (!(l.amount > 0)) return false;
        if (!STELLAR_ADDR.test(l.payee)) {
          warnings.push(
            `Could not resolve a Stellar address${l.reason ? ` for "${l.reason}"` : ''}. Add the G... address.`,
          );
          return false;
        }
        return true;
      });

    if (raw.kind === 'pay' || raw.kind === 'disburse') {
      if (lines.length === 0) {
        return this.none(
          source,
          raw.rationale ||
            'I could not build a valid payment. Give me an amount and a G... address.',
          warnings,
        );
      }
      const kind = lines.length === 1 ? 'pay' : 'disburse';
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (available > 0 && total > available) {
        warnings.push(
          `This totals $${total.toFixed(2)} but only $${available.toFixed(2)} is available.`,
        );
      }
      return {
        kind,
        lines,
        service: null,
        budget: total,
        rationale: raw.rationale || `Send $${total.toFixed(2)} across ${lines.length} payment(s).`,
        warnings,
        source,
      };
    }

    if (raw.kind === 'hire') {
      const q = (raw.serviceQuery ?? '').trim();
      const svc = q
        ? await this.prisma.service.findFirst({
            where: { status: 'ACTIVE', name: { contains: q, mode: 'insensitive' } },
            select: { id: true, name: true, pricePerCall: true },
          })
        : null;
      if (!svc) {
        warnings.push(
          'No matching service found. Pick one from Services, or name it more specifically.',
        );
        return this.none(source, raw.rationale || 'I could not find a matching service.', warnings);
      }
      const budget = Math.max(Number(raw.budget) || 0, Number(svc.pricePerCall));
      if (available > 0 && budget > available) {
        warnings.push(
          `Budget $${budget.toFixed(2)} exceeds the $${available.toFixed(2)} available.`,
        );
      }
      return {
        kind: 'hire',
        lines: [],
        service: { id: svc.id, name: svc.name, pricePerCall: Number(svc.pricePerCall) },
        budget,
        rationale: raw.rationale || `Hire ${svc.name} with a $${budget.toFixed(2)} budget.`,
        warnings,
        source,
      };
    }

    return this.none(
      source,
      raw.rationale || 'That does not look like a spending instruction.',
      warnings,
    );
  }

  private none(source: AgentPlan['source'], rationale: string, warnings: string[]): AgentPlan {
    return {
      kind: 'none',
      lines: [],
      service: null,
      budget: 0,
      rationale,
      warnings,
      source,
    };
  }
}

// ── Deterministic fallback (no API key) ───────────────────────────────────────
// A small, safe grammar so the agent still works without an LLM provider. The full
// natural-language planner (any phrasing) kicks in once ANTHROPIC_API_KEY or
// OPENAI_API_KEY is set on the API.
const PAY_RE =
  /(?:pay|send)\s+\$?([0-9]+(?:\.[0-9]+)?)\s*(?:usdc)?\s+to\s+(G[A-Z2-7]{55})(?:\s+for\s+(.+))?/i;
/** "...<amount> each..." for an equal-amount disbursement. */
const EACH_RE = /(?:pay|send|disburse|give)\s+\$?([0-9]+(?:\.[0-9]+)?)\s*(?:usdc)?\s+each/i;
/** Every Stellar address mentioned. */
const ADDR_RE = /G[A-Z2-7]{55}/g;

function fallbackParse(instruction: string): { plan: RawPlan; source: AgentPlan['source'] } {
  // "pay 5 to G… for X" — a single direct payment.
  const m = PAY_RE.exec(instruction);
  if (m) {
    return {
      source: 'fallback',
      plan: {
        kind: 'pay',
        lines: [{ payee: m[2], amount: Number(m[1]), reason: (m[3] ?? '').trim() }],
        serviceQuery: '',
        budget: 0,
        rationale: 'Parsed a direct payment.',
      },
    };
  }

  // "send 1 usdc each to these wallets: G…, G…, G…" — equal-amount disbursement.
  const each = EACH_RE.exec(instruction);
  const addrs = [...new Set(instruction.match(ADDR_RE) ?? [])];
  if (each && addrs.length >= 1) {
    const amount = Number(each[1]);
    return {
      source: 'fallback',
      plan: {
        kind: 'disburse',
        lines: addrs.map((payee) => ({ payee, amount, reason: '' })),
        serviceQuery: '',
        budget: 0,
        rationale: `Parsed a disbursement of ${amount} USDC each to ${addrs.length} recipient${addrs.length > 1 ? 's' : ''}.`,
      },
    };
  }

  return {
    source: 'fallback',
    plan: {
      kind: 'none',
      lines: [],
      serviceQuery: '',
      budget: 0,
      rationale:
        'I couldn’t read that. Use the Pay, Disburse, or Hire buttons below, or phrase it simply, like "pay 5 to G… for data" or "send 1 each to G…, G…, G…".',
    },
  };
}

/** Coerce an unknown tool_use.input into the RawPlan shape defensively. */
function normalizeRaw(input: unknown): RawPlan {
  const o = (input ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(o.lines) ? (o.lines as PlanLine[]) : [];
  const kind = ['pay', 'disburse', 'hire', 'none'].includes(String(o.kind))
    ? (o.kind as RawPlan['kind'])
    : 'none';
  return {
    kind,
    lines,
    serviceQuery: typeof o.serviceQuery === 'string' ? o.serviceQuery : '',
    budget: typeof o.budget === 'number' ? o.budget : 0,
    rationale: typeof o.rationale === 'string' ? o.rationale : '',
  };
}
