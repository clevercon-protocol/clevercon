/**
 * Spend-policy binding-proof prover (protocol pp/1, v1).
 *
 * This produces the proof the on-chain `policy-verifier` contract actually
 * checks: a host-accelerated binding proof, NOT a full UltraHonk proof. Soroban
 * has no pairing precompile (blocked on CAP-0058), so the contract binds the
 * proof to the exact public inputs via a SHA-256 transcript rather than
 * verifying pairings. That binding proof is deterministic and needs no `bb`, so
 * it is constructible here in TypeScript. The separate UltraHonk compliance
 * proof (trusted off-chain in v1) is produced by the circuit toolchain in CI.
 *
 * The wire format and construction mirror `contracts/policy-verifier`
 * (verifier.rs + fixtures/vectors.rs) byte-for-byte:
 *
 *   [  0.. 32) pi_commitment      = SHA-256(PI0 || PI1 || PI2 || PI3)
 *   [ 32.. 64) circuit_id         = SHA-256("clevercon-spend-policy-v1")
 *   [ 64.. 96) linearisation_eval = SHA-256(zeta || grand_product_eval)
 *   [ 96..128) grand_product_eval
 *   [128..160) selector_evals_hash
 *   [160..192) opening_eval       (chosen so the opening check closes)
 *   [192..224) shifted_opening_eval
 *   [224..512) zero padding
 *
 * where zeta = SHA-256(circuit_id || pi_hash || selector_evals_hash) and the
 * opening check requires SHA-256(zeta || opening_eval || shifted || domain_tag)[0] == 0x00.
 */
import { createHash, randomBytes } from 'node:crypto';
import { encodePublicInputs } from './policy-inputs.js';

export const CIRCUIT_DOMAIN_SEP = 'clevercon-spend-policy-v1';

// Must match the VK the contract is initialised with (fixtures/vectors.rs).
const CIRCUIT_SIZE = 16_384;
const LOG_CIRCUIT_SIZE = 14; // log2(16384)
const PUB_INPUTS_OFFSET = 1;
const PROOF_LEN = 512; // MIN_PROOF_LEN; header is 224 bytes, rest is zero padding
const HEADER_LEN = 224;

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** The circuit domain separator / Fiat-Shamir circuit id. */
export function circuitId(): Buffer {
  return sha256(Buffer.from(CIRCUIT_DOMAIN_SEP));
}

/**
 * A fresh, unique nullifier for a release. The vault records it (unique) to
 * prevent replaying the same authorised spend. Random is sufficient here since
 * uniqueness, not unlinkability of a specific spend, is the v1 requirement.
 */
export function generateNullifier(): Buffer {
  return randomBytes(32);
}

export interface BindingProofInput {
  /** PI0: the 32-byte policy commitment (Buffer or hex). */
  commitment: Buffer | string;
  /** The Stellar payee address (G...). */
  payeeAddress: string;
  /** Release amount in stroops. */
  amountStroops: bigint;
  /** PI3: the 32-byte nullifier (Buffer or hex). */
  nullifier: Buffer | string;
  /**
   * Optional evaluation fields. Left unset they are derived so each proof is
   * self-consistent; the contract only checks the transcript relations, not
   * specific values, so these are free parameters in v1.
   */
  grandProductEval?: Buffer;
  selectorEvalsHash?: Buffer;
  shiftedOpeningEval?: Buffer;
}

export interface BindingProof {
  /** The 512-byte proof accepted by policy-verifier.verify. */
  proof: Buffer;
  /** SHA-256 of the canonical public-input vector (proof bytes [0..32)). */
  piHash: Buffer;
}

/**
 * Build the contract-compatible binding proof for one release. Deterministic
 * given its inputs (the opening_eval search walks a counter, not randomness),
 * so the same release always yields the same proof.
 */
export function buildBindingProof(input: BindingProofInput): BindingProof {
  const { piHash } = encodePublicInputs(
    input.commitment,
    input.payeeAddress,
    input.amountStroops,
    input.nullifier,
  );

  const cid = circuitId();
  const selectorEvalsHash = input.selectorEvalsHash ?? sha256(Buffer.from('sel-evals-placeholder'));
  const zeta = sha256(cid, piHash, selectorEvalsHash);
  const grandProductEval = input.grandProductEval ?? sha256(Buffer.from('gp-eval-placeholder'));
  const linearisationEval = sha256(zeta, grandProductEval);
  const shiftedOpeningEval =
    input.shiftedOpeningEval ?? sha256(Buffer.from('shifted-eval-placeholder'));
  const domainTag = Buffer.concat([u32be(LOG_CIRCUIT_SIZE), u32be(PUB_INPUTS_OFFSET)]);

  // Find opening_eval whose closing hash starts with 0x00. Walking a 32-bit
  // counter (not just the last byte) makes this robust for any zeta, unlike a
  // single-byte search which succeeds only ~63% of the time.
  const openingEval = Buffer.alloc(32);
  let found = false;
  for (let c = 0; c < 1_000_000; c++) {
    openingEval.writeUInt32BE(c >>> 0, 28);
    if (sha256(zeta, openingEval, shiftedOpeningEval, domainTag)[0] === 0x00) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error('could not satisfy the opening-consistency check');

  const proof = Buffer.alloc(PROOF_LEN);
  piHash.copy(proof, 0);
  cid.copy(proof, 32);
  linearisationEval.copy(proof, 64);
  grandProductEval.copy(proof, 96);
  selectorEvalsHash.copy(proof, 128);
  openingEval.copy(proof, 160);
  shiftedOpeningEval.copy(proof, 192);
  // [224..512) stays zero.
  return { proof, piHash };
}

/**
 * Mirror the contract's `verify_proof` checks so a producer can validate a
 * proof before spending gas on an on-chain call. This is a convenience
 * pre-check, NOT a replacement for the authoritative on-chain verification.
 */
export function verifyBindingProofLocally(proof: Buffer, piHash: Buffer): boolean {
  if (proof.length < HEADER_LEN) return false;
  const piCommitment = proof.subarray(0, 32);
  const cid = proof.subarray(32, 64);
  const linearisationEval = proof.subarray(64, 96);
  const grandProductEval = proof.subarray(96, 128);
  const selectorEvalsHash = proof.subarray(128, 160);
  const openingEval = proof.subarray(160, 192);
  const shiftedOpeningEval = proof.subarray(192, 224);

  if (!piCommitment.equals(piHash)) return false;

  const zeta = sha256(cid, piHash, selectorEvalsHash);
  if (!sha256(zeta, grandProductEval).equals(linearisationEval)) return false;

  const domainTag = Buffer.concat([u32be(LOG_CIRCUIT_SIZE), u32be(PUB_INPUTS_OFFSET)]);
  return sha256(zeta, openingEval, shiftedOpeningEval, domainTag)[0] === 0x00;
}

/** The VK parameters the contract must be initialised with for this circuit. */
export const VK_PARAMS = { CIRCUIT_SIZE, LOG_CIRCUIT_SIZE, PUB_INPUTS_OFFSET } as const;
