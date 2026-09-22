import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, ProofStatus } from '@clevercon/db';
import { StrKey } from '@stellar/stellar-sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly queue?: QueueService,
  ) {}

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

    // The commitment binds the rule in both modes: a SHA-256 of the canonical
    // encoding. The difference is what is persisted. Transparent mode stores the
    // plaintext rule (ruleSummary) so it is publicly auditable; private mode
    // stores ONLY the commitment and discards the plaintext, so the server never
    // holds the rule. (v1 uses SHA-256, matching the on-chain binding check; a
    // client-side commitment with the circuit hash is the migration target, see
    // docs/private-policies.md.)
    const commitment = createHash('sha256').update(canonicalEncoding(params.rules)).digest('hex');

    const created = await this.prisma.policy.create({
      data: {
        userId,
        commitment,
        isPrivate: params.isPrivate ?? false,
        ruleSummary: params.isPrivate
          ? undefined
          : (params.rules as unknown as Prisma.InputJsonValue),
      },
    });
    return serialize(created);
  }

  /**
   * Request a binding proof authorising a release (payee + amount) under a
   * policy the caller owns. Reserves a unique nullifier, creates the Proof in
   * REQUESTED, and enqueues generation; the worker fills in the proof and flips
   * it to READY. Returns immediately with the proof id to poll (or receive over
   * the WebSocket as `proof.updated`).
   */
  async requestProof(userId: string, policyId: string, payeeAddress: string, amountUsdc: number) {
    if (!StrKey.isValidEd25519PublicKey(payeeAddress)) {
      throw new BadRequestException('Invalid payee address');
    }
    if (!(amountUsdc > 0)) throw new BadRequestException('Amount must be positive');

    const policy = await this.prisma.policy.findFirst({ where: { id: policyId, userId } });
    if (!policy) throw new NotFoundException('Policy not found');

    const proof = await this.prisma.proof.create({
      data: {
        policyId,
        status: ProofStatus.REQUESTED,
        nullifier: randomBytes(32).toString('hex'),
      },
    });

    await this.queue?.enqueueProofGeneration({
      proofId: proof.id,
      payeeAddress,
      amountStroops: String(Math.round(amountUsdc * STROOPS_PER_USDC)),
    });

    return { proofId: proof.id, status: proof.status };
  }

  /** Read a proof's status; scoped to the caller via the owning policy. */
  async getProof(userId: string, proofId: string) {
    const proof = await this.prisma.proof.findUnique({
      where: { id: proofId },
      include: { policy: { select: { userId: true } } },
    });
    if (!proof || proof.policy?.userId !== userId) throw new NotFoundException('Proof not found');
    return {
      id: proof.id,
      status: proof.status,
      hasProof: proof.proofRef !== null,
      nullifier: proof.nullifier,
      createdAt: proof.createdAt,
      updatedAt: proof.updatedAt,
    };
  }
}
