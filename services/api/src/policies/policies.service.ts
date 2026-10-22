import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, ProofStatus } from '@clevercon/db';
import type { RuleForm } from '@clevercon/common';
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
  /** User-facing rule name. */
  name?: string;
  /** The lane this rule belongs to; wins over `isPrivate` when both are given. */
  form?: RuleForm;
  /** Flag this rule as the account's global for its lane. */
  global?: boolean;
  /** When editing: the id of the policy this new version replaces. */
  supersedes?: string;
  /**
   * Private rules only: the canonical pp/2 commitment (32-byte hex) the client
   * computed from the rule + its device salt. The owner pins this and every
   * disburse proof reproduces it, so the server MUST store the client value, not
   * a server-derived one. Ignored for public rules (server derives theirs).
   */
  commitment?: string;
  /**
   * Private rules only: a wallet-encrypted backup of {clauses, salt} (opaque
   * ciphertext). The server stores it verbatim and can never read it.
   */
  encryptedBackup?: string;
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
  encryptedBackup: string | null;
  name: string | null;
  form: string;
  status: string;
  version: number;
  supersedes: string | null;
  global: boolean;
  createdAt: Date;
}) {
  return {
    id: p.id,
    commitment: p.commitment,
    isPrivate: p.isPrivate,
    // ruleSummary is present only for transparent (or explicitly opted-in) policies.
    rules: p.ruleSummary,
    // The owner's device decrypts this to re-prove a private rule across devices.
    encryptedBackup: p.encryptedBackup,
    name: p.name,
    form: p.form,
    status: p.status,
    version: p.version,
    supersedes: p.supersedes,
    global: p.global,
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

    // The form (lane) is the source of truth for privacy; the legacy isPrivate
    // flag is honoured only when no form is given, so old callers keep working.
    const form: RuleForm = params.form ?? (params.isPrivate === false ? 'public' : 'private');
    const isPrivate = form === 'private';

    // The commitment binds the rule. A private rule's commitment is the canonical
    // pp/2 Poseidon value the CLIENT computed from the rule + its device salt
    // (docs/private-policies-v2.md section 3): the owner pins it and every
    // browser disburse proof must reproduce it, so the server stores the client
    // value verbatim and never holds the rule. A public rule is auditable and
    // stored cleartext (ruleSummary), so the server derives its commitment as a
    // SHA-256 of the canonical encoding (the pp/1 binding check). If a private
    // caller omits the client commitment (legacy), fall back to SHA-256 so
    // creation still works, though that rule will not be pp/2-pinnable.
    let commitment: string;
    if (isPrivate && params.commitment) {
      if (!/^[0-9a-fA-F]{64}$/.test(params.commitment)) {
        throw new BadRequestException('commitment must be 32-byte hex (64 chars)');
      }
      commitment = params.commitment.toLowerCase();
    } else {
      commitment = createHash('sha256').update(canonicalEncoding(params.rules)).digest('hex');
    }

    // Editing a rule is versioning: the new row supersedes the old under the
    // same lineage, and the superseded rule is archived. Ownership is checked
    // before either write.
    let version = 1;
    if (params.supersedes) {
      const prior = await this.prisma.policy.findFirst({
        where: { id: params.supersedes, userId },
      });
      if (!prior) throw new NotFoundException('Superseded policy not found');
      version = prior.version + 1;
    }

    const created = await this.prisma.policy.create({
      data: {
        userId,
        commitment,
        isPrivate,
        form,
        status: 'active',
        version,
        supersedes: params.supersedes,
        global: params.global ?? false,
        name: params.name,
        ruleSummary: isPrivate ? undefined : (params.rules as unknown as Prisma.InputJsonValue),
        // Private rules keep a wallet-encrypted backup (ciphertext); public rules
        // are already cleartext, so there is nothing to back up privately.
        encryptedBackup: isPrivate ? params.encryptedBackup : undefined,
      },
    });

    if (params.supersedes) {
      await this.prisma.policy.update({
        where: { id: params.supersedes },
        data: { status: 'archived' },
      });
    }

    return serialize(created);
  }

  /** Archive a policy the caller owns: hidden from pickers, kept for audit. */
  async archive(userId: string, id: string) {
    const policy = await this.prisma.policy.findFirst({ where: { id, userId } });
    if (!policy) throw new NotFoundException('Policy not found');
    const updated = await this.prisma.policy.update({
      where: { id },
      data: { status: 'archived' },
    });
    return serialize(updated);
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
