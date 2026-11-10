import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, ServiceStatus, encryptSecret, decryptSecret } from '@clevercon/db';
import type { Prerequisite } from '@clevercon/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultContractService } from '../vault/vault-contract.service.js';
import { satisfiedKeys } from './prerequisites.js';

type ServiceWithRep = Prisma.ServiceGetPayload<{ include: { reputation: true } }>;

export type ServiceSort = 'trust' | 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface ListParams {
  q?: string;
  category?: string;
  capability?: string;
  tier?: string;
  paymentModel?: string;
  interaction?: string;
  maxPrice?: number;
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

/**
 * A service's trust tier, earned by REAL on-chain settlements (successfulJobs is
 * only incremented when a job actually completes and the provider is paid, see
 * workers/executor.ts). This is our anti-spam primitive: a freshly listed service
 * is `new` and ranks last until it proves itself with settled work, so listing is
 * open (anyone can register) without the directory filling with unproven noise.
 */
export type TrustTier = 'new' | 'active' | 'trusted';
// `trusted` requires distinct paying counterparties (uniquePayers), so a provider
// cannot self-deal its way up by paying itself: each fake settlement costs real
// USDC and does not add a new payer. This is the core anti-Sybil defense.
function trustTier(
  settlements: number,
  score: number,
  uniquePayers: number,
  disputesUpheld: number,
  totalJobs: number,
): TrustTier {
  const disputeRate = totalJobs > 0 ? disputesUpheld / totalJobs : 0;
  if (disputeRate > 0.2) return 'new'; // a high upheld-dispute rate sinks any service
  if (settlements >= 10 && score >= 4 && uniquePayers >= 2 && disputeRate < 0.05) return 'trusted';
  if (settlements >= 1) return 'active';
  return 'new';
}

interface PayerStat {
  payers: number;
  lastSettled: Date | null;
}

/** Curated services we vouch for, by registry agent_id (comma-separated env). */
function verifiedAgentIds(): Set<string> {
  return new Set(
    (process.env.VERIFIED_AGENT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Map the public sort keys to Prisma orderBy. Every service carries a (zeroed)
// reputation row, so ordering by the relation is well-defined. `trust` is the
// default: settlement-gated (most settled + highest-rated first), so proven
// services surface and unproven ones sink, pagination-correct in SQL.
const SORT_ORDER: Record<ServiceSort, Prisma.ServiceOrderByWithRelationInput[]> = {
  trust: [
    { reputation: { successfulJobs: 'desc' } },
    { reputation: { score: 'desc' } },
    { registeredAt: 'desc' },
  ],
  recent: [{ registeredAt: 'desc' }],
  rating: [{ reputation: { score: 'desc' } }],
  price_asc: [{ pricePerCall: 'asc' }],
  price_desc: [{ pricePerCall: 'desc' }],
};

function serialize(s: ServiceWithRep, verified: Set<string>, stat?: PayerStat) {
  const settlements = s.reputation?.successfulJobs ?? 0;
  const score = s.reputation?.score ?? 0;
  const uniquePayers = stat?.payers ?? 0;
  const disputesUpheld = s.reputation?.disputesUpheld ?? 0;
  const totalJobs = s.reputation?.totalJobs ?? 0;
  return {
    id: s.id,
    agentId: s.agentId,
    name: s.name,
    description: s.description,
    category: s.category,
    capabilities: s.capabilities,
    pricingModel: s.pricingModel,
    pricePerCall: Number(s.pricePerCall),
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    // The service's verification tier (T1 trustless / T2 attestable / T3 human).
    tier: s.tier,
    // The public acceptance contract: how delivery is judged (method + spec) and
    // the result shape. Public by design so a buyer/agent can verify trustlessly
    // (SDK verifyResult) rather than trusting the provider or the server.
    verification: s.verification ?? null,
    outputSchema: s.outputSchema ?? null,
    inputSchema: s.inputSchema ?? null,
    // Interaction/payment shape + input-file requirement, so a buyer/agent knows
    // HOW to hire this service (sync vs async/human/metered) and what to attach.
    // null = sync/escrow with no required attachments (back-compat).
    interaction: s.interaction ?? null,
    paymentModel: s.paymentModel ?? null,
    attachmentsIn: s.attachmentsIn ?? null,
    // Requirement catalog (every requirement any function may need). A buyer is gated
    // per function, not for the whole service.
    prerequisites: s.prerequisites ?? null,
    // The callable functions, each with its own io, required requirement keys, and
    // pricing. null = a single-function service described by the top-level fields.
    functions: s.functions ?? null,
    // Who listed this and how to reach them (website, docs, support, socials).
    contactLinks: s.contactLinks ?? null,
    // System-managed endpoint health (auto-recovering). The directory already hides
    // unhealthy services; this lets a direct link show it is temporarily unavailable.
    healthy: s.healthy,
    // Settlement-gated trust, surfaced for the marketplace: the trust level, the
    // count of real settled jobs, and whether we've curated/vouched for it.
    trust: trustTier(settlements, score, uniquePayers, disputesUpheld, totalJobs),
    settlements,
    // Distinct paying counterparties (anti-self-dealing) + recency, from real
    // confirmed settlements. Computed read-side for now; move to an incremented
    // column if the directory volume grows.
    uniquePayers,
    lastSettled: stat?.lastSettled ?? null,
    verified: verified.has(s.agentId),
    reputation: s.reputation
      ? {
          score: s.reputation.score,
          totalJobs: s.reputation.totalJobs,
          avgLatencyMs: s.reputation.avgLatencyMs,
        }
      : null,
  };
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly vault?: VaultContractService,
  ) {}

  /**
   * The public protocol fee in basis points (0 = no fee / not configured). Read
   * from the vault so buyers and providers can see the take rate before hiring.
   * Best-effort: any read failure returns 0 so the marketplace never breaks over it.
   */
  async platformFeeBps(): Promise<{ bps: number }> {
    if (!this.vault?.active) return { bps: 0 };
    try {
      const { bps } = await this.vault.getFee();
      return { bps };
    } catch {
      return { bps: 0 };
    }
  }

  /**
   * Distinct paying counterparties and last-settled time per service, from real
   * CONFIRMED settlements (payments joined through steps to the service). Only
   * service-hire payments carry a stepId, so disburses are naturally excluded.
   * Best-effort: never fail a listing over a stats query.
   */
  private async payerStats(ids: string[]): Promise<Map<string, PayerStat>> {
    const map = new Map<string, PayerStat>();
    if (ids.length === 0) return map;
    try {
      const rows = await this.prisma.$queryRaw<
        { sid: string; payers: bigint; last: Date | null }[]
      >`
        SELECT ts."serviceId" AS sid,
               COUNT(DISTINCT t."buyerId") AS payers,
               MAX(p."createdAt") AS last
        FROM "payments" p
        JOIN "task_steps" ts ON p."stepId" = ts.id
        JOIN "tasks" t ON p."taskId" = t.id
        WHERE p.status = 'CONFIRMED' AND ts."serviceId" IN (${Prisma.join(ids)})
        GROUP BY ts."serviceId"
      `;
      for (const r of rows) map.set(r.sid, { payers: Number(r.payers), lastSettled: r.last });
    } catch {
      // degrade to zero stats rather than break the directory
    }
    return map;
  }

  async list(params: ListParams) {
    const where: Prisma.ServiceWhereInput = {
      status: { in: [ServiceStatus.ACTIVE, ServiceStatus.NEW] },
      // Hide services whose endpoint is failing its health check, so a buyer never
      // hires a dead service. Fail-open + auto-recovering: `healthy` defaults true
      // (a never-checked service stays listed), and the sweep flips it back on when
      // the endpoint recovers, so this never requires provider action.
      healthy: true,
    };
    if (params.category) where.category = params.category;
    if (params.tier) where.tier = params.tier;
    if (params.capability) where.capabilities = { has: params.capability };
    if (params.maxPrice != null) where.pricePerCall = { lte: new Prisma.Decimal(params.maxPrice) };
    // Manifest-v2 axes. A null column means the default (sync/escrow), so filtering
    // by the default value must also match legacy rows that never set it. Composed
    // via AND so it never clobbers the search OR above.
    const and: Prisma.ServiceWhereInput[] = [];
    if (params.interaction) {
      and.push(
        params.interaction === 'sync'
          ? { OR: [{ interaction: 'sync' }, { interaction: null }] }
          : { interaction: params.interaction },
      );
    }
    if (params.paymentModel) {
      and.push(
        params.paymentModel === 'escrow'
          ? { OR: [{ paymentModel: 'escrow' }, { paymentModel: null }] }
          : { paymentModel: params.paymentModel },
      );
    }
    if (and.length) where.AND = and;
    // Server-side search so it composes correctly with pagination.
    if (params.q)
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
      ];

    const take = Math.min(params.limit ?? 50, 100);
    const skip = params.offset ?? 0;
    const orderBy = SORT_ORDER[params.sort ?? 'trust'];
    const verified = verifiedAgentIds();
    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({ where, include: { reputation: true }, orderBy, take, skip }),
      this.prisma.service.count({ where }),
    ]);
    const stats = await this.payerStats(rows.map((r) => r.id));
    return {
      items: rows.map((r) => serialize(r, verified, stats.get(r.id))),
      total,
      limit: take,
      offset: skip,
    };
  }

  async get(id: string) {
    const s = await this.prisma.service.findUnique({
      where: { id },
      include: { reputation: true },
    });
    if (!s) throw new NotFoundException('Service not found');
    const stats = await this.payerStats([s.id]);
    return serialize(s, verifiedAgentIds(), stats.get(s.id));
  }

  /**
   * A buyer's setup status for one service's usage requirements: each prerequisite,
   * whether it is satisfied, and the saved NON-SECRET values (a secret is never echoed
   * back, only whether it is set).
   */
  async getSetup(userId: string, serviceId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { prerequisites: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    const prerequisites = (service.prerequisites ?? []) as unknown as Prerequisite[];
    const setup = await this.prisma.serviceSetup.findUnique({
      where: { userId_serviceId: { userId, serviceId } },
    });
    const have = satisfiedKeys(setup);
    const data = (setup?.data ?? {}) as Record<string, unknown>;
    return {
      prerequisites,
      requirements: prerequisites.map((p) => ({
        key: p.key,
        satisfied: have.has(p.key),
        // Echo a non-secret value so the form can show what was entered; never a secret.
        value: p.secret ? undefined : data[p.key],
      })),
    };
  }

  /**
   * Save a buyer's answers to a service's usage requirements. Secret values (API
   * keys/tokens) are encrypted into `secretCipher`; non-secret values go in `data`.
   * Merges with any existing setup, so a partial update never clears other answers.
   */
  async saveSetup(userId: string, serviceId: string, values: Record<string, string>) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { prerequisites: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    const prerequisites = (service.prerequisites ?? []) as unknown as Prerequisite[];
    const byKey = new Map(prerequisites.map((p) => [p.key, p]));

    const existing = await this.prisma.serviceSetup.findUnique({
      where: { userId_serviceId: { userId, serviceId } },
    });
    const data = { ...((existing?.data ?? {}) as Record<string, unknown>) };
    let secrets: Record<string, unknown> = {};
    if (existing?.secretCipher) {
      try {
        secrets = JSON.parse(decryptSecret(existing.secretCipher)) as Record<string, unknown>;
      } catch {
        secrets = {};
      }
    }
    for (const [key, raw] of Object.entries(values)) {
      const p = byKey.get(key);
      if (!p) throw new BadRequestException(`Unknown requirement: ${key}`);
      const value = String(raw ?? '').trim();
      if (p.secret) {
        if (value) secrets[key] = value;
        else delete secrets[key];
      } else {
        if (value) data[key] = value;
        else delete data[key];
      }
    }
    const secretCipher = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
    await this.prisma.serviceSetup.upsert({
      where: { userId_serviceId: { userId, serviceId } },
      update: { data: data as Prisma.InputJsonValue, secretCipher },
      create: { userId, serviceId, data: data as Prisma.InputJsonValue, secretCipher },
    });
    return this.getSetup(userId, serviceId);
  }
}
