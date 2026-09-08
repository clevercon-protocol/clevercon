import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * A spending policy expressed as the four composable rule types from
 * docs/private-policies.md. All amounts are USDC (converted to stroops for the
 * canonical encoding). Every rule is optional; at least one MUST be enabled.
 */
export interface PolicyRules {
  perPaymentCeilingUsdc?: number; // R1
  rollingCapUsdc?: number; // R2 amount
  rollingWindowSecs?: number; // R2 window
  allowlist?: string[]; // R3 (payee addresses)
  denylist?: string[]; // R4 entries
  denylistThresholdUsdc?: number; // R4 threshold
}

export interface CreatePolicyParams {
  rules: PolicyRules;
  isPrivate?: boolean;
}

const STROOPS_PER_USDC = 10_000_000;

function usdc(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(Math.round(n * STROOPS_PER_USDC));
}

/**
 * Deterministic canonical encoding of a transparent policy, used to derive its
 * commitment. Amounts are in stroops; keys are emitted in a fixed order so two
 * identical policies hash identically. (Private policies use the Poseidon2
 * commitment from the circuit instead; see docs/private-policies.md section 3.)
 */
function canonicalEncoding(rules: PolicyRules): string {
  const norm = {
    v: 1,
    r1_ceiling: usdc(rules.perPaymentCeilingUsdc) ?? null,
    r2_cap: usdc(rules.rollingCapUsdc) ?? null,
    r2_window: rules.rollingWindowSecs ?? null,
    r3_allowlist: [...(rules.allowlist ?? [])].sort(),
    r4_denylist: [...(rules.denylist ?? [])].sort(),
    r4_threshold: usdc(rules.denylistThresholdUsdc) ?? null,
  };
  return JSON.stringify(norm);
}

function enabledCount(rules: PolicyRules): number {
  let n = 0;
  if (rules.perPaymentCeilingUsdc !== undefined) n++;
  if (rules.rollingCapUsdc !== undefined) n++;
  if (rules.allowlist && rules.allowlist.length > 0) n++;
  if (rules.denylist && rules.denylist.length > 0) n++;
  return n;
}

function serialize(p: {
  id: string;
  commitment: string;
  isPrivate: boolean;
  ruleSummary: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    commitment: p.commitment,
    isPrivate: p.isPrivate,
    // ruleSummary is present only for transparent (or explicitly opted-in) policies.
    rules: p.ruleSummary,
    createdAt: p.createdAt,
  };
}

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.policy.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map(serialize), total: rows.length };
  }

  async create(userId: string, params: CreatePolicyParams) {
    if (enabledCount(params.rules) === 0) {
      throw new BadRequestException('A policy must enable at least one rule');
    }

    if (params.isPrivate) {
      // Private policies require the Noir circuit + prover to produce the
      // Poseidon2 commitment and the proof-gated release. Until that lands we do
      // not fabricate a commitment; the transparent path is fully available.
      throw new NotImplementedException(
        'Private (zero-knowledge) policies are not enabled yet; use transparent mode for now',
      );
    }

    // Transparent policy: the rule is stored in the clear and the commitment is
    // a SHA-256 of the canonical encoding (verifiable, but not hiding without
    // the ZK layer, which is the point of transparent mode).
    const commitment = createHash('sha256').update(canonicalEncoding(params.rules)).digest('hex');

    const created = await this.prisma.policy.create({
      data: {
        userId,
        commitment,
        isPrivate: false,
        ruleSummary: params.rules as unknown as Prisma.InputJsonValue,
      },
    });
    return serialize(created);
  }
}
