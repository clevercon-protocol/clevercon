import { type PrismaClient, ProofStatus } from '@clevercon/db';
import { buildBindingProof, verifyBindingProofLocally, generateNullifier } from '@clevercon/common';

export interface GenerateProofResult {
  status: 'ready' | 'failed' | 'skipped';
  reason?: string;
  /** The buyer of the linked task, so the worker can push a real-time update. */
  buyerId?: string;
}

// A proof that already reached one of these is not regenerated.
const TERMINAL: ProofStatus[] = [ProofStatus.READY, ProofStatus.VERIFIED, ProofStatus.REJECTED];

/**
 * Drive one proof's lifecycle: load the REQUESTED proof and its policy, build
 * the contract-compatible binding proof for the release (commitment from the
 * policy, plus payee/amount/nullifier), self-check it, and store it as the
 * proofRef with status READY. On any failure the proof is marked FAILED.
 *
 * Idempotent: an already-terminal proof is a no-op, so BullMQ retries never
 * regenerate or double-write. The binding proof is deterministic, so a retry
 * after a transient DB error reproduces the same bytes.
 */
export async function generateProof(
  prisma: PrismaClient,
  proofId: string,
  payeeAddress: string,
  amountStroops: bigint,
): Promise<GenerateProofResult> {
  const proof = await prisma.proof.findUnique({
    where: { id: proofId },
    include: { policy: true },
  });
  if (!proof) return { status: 'skipped', reason: 'proof not found' };
  // Proof has a taskId scalar (no relation), so resolve the buyer separately for
  // the real-time emit; a proof without a task simply has no room to notify.
  const buyerId = proof.taskId
    ? (await prisma.task.findUnique({ where: { id: proof.taskId }, select: { buyerId: true } }))
        ?.buyerId
    : undefined;
  if (TERMINAL.includes(proof.status))
    return { status: 'skipped', reason: 'proof already terminal', buyerId };
  if (!proof.policy) {
    await prisma.proof.update({ where: { id: proofId }, data: { status: ProofStatus.FAILED } });
    return { status: 'failed', reason: 'proof has no policy', buyerId };
  }

  await prisma.proof.update({ where: { id: proofId }, data: { status: ProofStatus.GENERATING } });

  try {
    // Reuse the reserved nullifier if the request set one, else mint a fresh one.
    const nullifier = proof.nullifier ? Buffer.from(proof.nullifier, 'hex') : generateNullifier();
    const { proof: bytes, piHash } = buildBindingProof({
      commitment: proof.policy.commitment,
      payeeAddress,
      amountStroops,
      nullifier,
    });
    // Self-check against the on-chain verification logic before persisting, so a
    // malformed proof never reaches the vault.
    if (!verifyBindingProofLocally(bytes, piHash)) {
      throw new Error('binding proof failed local verification');
    }
    await prisma.proof.update({
      where: { id: proofId },
      data: {
        status: ProofStatus.READY,
        proofRef: bytes.toString('base64'),
        nullifier: nullifier.toString('hex'),
      },
    });
    return { status: 'ready', buyerId };
  } catch (err) {
    await prisma.proof.update({ where: { id: proofId }, data: { status: ProofStatus.FAILED } });
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      buyerId,
    };
  }
}
