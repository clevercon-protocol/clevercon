import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultService } from '../vault/vault.service.js';
import { PoliciesService } from '../policies/policies.service.js';

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
            description: 'Stellar address (G...). Leave empty if the user gave a name, not an address.',
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
    rationale: { type: 'string', description: 'one short sentence explaining the plan to the user' },
  },
  required: ['kind', 'lines', 'serviceQuery', 'budget', 'rationale'],
};

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
    private readonly policies: PoliciesService,
  ) {}

  private apiKey() {
    return process.env.ANTHROPIC_API_KEY ?? '';
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

    const raw = this.apiKey() ? await this.parseWithClaude(userId, text) : fallbackParse(text);
    const available = await this.vault
      .getForUser(userId)
      .then((v) => v.available)
      .catch(() => 0);
    return this.validate(raw.plan, raw.source, available);
  }

  private async parseWithClaude(
    userId: string,
    instruction: string,
  ): Promise<{ plan: RawPlan; source: AgentPlan['source'] }> {
    try {
      const context = await this.buildContext(userId);
      const client = new Anthropic({ apiKey: this.apiKey(), timeout: 30_000, maxRetries: 1 });
      const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        system:
          'You turn a user instruction into a spending plan for a non-custodial Stellar agent. ' +
          'The agent can pay one address, disburse to many, or hire a listed service. ' +
          'Only propose what the user actually asked for; never invent Stellar addresses. ' +
          'If the user names a person without an address, leave payee empty and put the name in reason. ' +
          'If the instruction is not a spend or is unclear, use kind "none" and explain in rationale. ' +
          'Amounts are USDC. Use the context (available budget, saved limits, services) to stay realistic.',
        messages: [{ role: 'user', content: `Instruction: ${instruction}\n\n${context}` }],
        tools: [
          {
            name: 'propose_plan',
            description: 'Return the structured spending plan for the user to review.',
            input_schema: PLAN_SCHEMA as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'propose_plan' },
      });
      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') throw new Error('no tool_use in response');
      return { plan: normalizeRaw(block.input), source: 'llm' };
    } catch (err) {
      this.logger.warn(`Claude planning failed, using fallback: ${(err as Error).message}`);
      return fallbackParse(instruction);
    }
  }

  private async buildContext(userId: string): Promise<string> {
    const [vault, limits, services] = await Promise.all([
      this.vault.getForUser(userId).catch(() => ({ available: 0 })),
      this.policies.list(userId).catch(() => ({ items: [] as unknown[] })),
      this.prisma.service.findMany({
        where: { status: 'ACTIVE' },
        select: { name: true, pricePerCall: true },
        take: 8,
      }),
    ]);
    const limitLines = (limits.items as { id: string; rules?: unknown }[])
      .map((p) => `- ${p.id}: ${JSON.stringify(p.rules ?? 'private')}`)
      .join('\n');
    const svc = services.map((s) => `- ${s.name} ($${Number(s.pricePerCall)}/call)`).join('\n');
    return [
      `Available budget: ${(vault as { available: number }).available} USDC.`,
      limitLines ? `Saved limits:\n${limitLines}` : 'No saved limits.',
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
          raw.rationale || 'I could not build a valid payment. Give me an amount and a G... address.',
          warnings,
        );
      }
      const kind = lines.length === 1 ? 'pay' : 'disburse';
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (available > 0 && total > available) {
        warnings.push(`This totals $${total.toFixed(2)} but only $${available.toFixed(2)} is available.`);
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
        warnings.push('No matching service found. Pick one from Services, or name it more specifically.');
        return this.none(source, raw.rationale || 'I could not find a matching service.', warnings);
      }
      const budget = Math.max(Number(raw.budget) || 0, Number(svc.pricePerCall));
      if (available > 0 && budget > available) {
        warnings.push(`Budget $${budget.toFixed(2)} exceeds the $${available.toFixed(2)} available.`);
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

    return this.none(source, raw.rationale || 'That does not look like a spending instruction.', warnings);
  }

  private none(source: AgentPlan['source'], rationale: string, warnings: string[]): AgentPlan {
    return { kind: 'none', lines: [], service: null, budget: 0, rationale, warnings, source };
  }
}

// ── Deterministic fallback (no API key) ───────────────────────────────────────
const PAY_RE =
  /(?:pay|send)\s+\$?([0-9]+(?:\.[0-9]+)?)\s*(?:usdc)?\s+to\s+(G[A-Z2-7]{55})(?:\s+for\s+(.+))?/i;

function fallbackParse(instruction: string): { plan: RawPlan; source: AgentPlan['source'] } {
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
  return {
    source: 'fallback',
    plan: {
      kind: 'none',
      lines: [],
      serviceQuery: '',
      budget: 0,
      rationale:
        'I could not parse that without the AI planner. Set ANTHROPIC_API_KEY, or use the Pay / Disburse / Hire actions.',
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
