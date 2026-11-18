/**
 * Byte-precise public-input encoding for the private spending-policy protocol.
 *
 * This is the shared, normative implementation of the wire format frozen in
 * docs/private-policies.md (protocol `pp/1`). The vault, verifier, circuit, and
 * prover must all agree on these exact bytes; putting the deterministic layer in
 * one tested place is what prevents the "two components disagree" failure the
 * spec warns about.
 *
 * Covered here: the SHA-256 layer that any party can compute from public data,
 * namely `payee_hash` (PI1), `amount_scalar` (PI2), and the `PI_hash` binding.
 * `commitment` (PI0) and `nullifier` (PI3) are Poseidon2 outputs produced by the
 * circuit; they enter this encoder as opaque 32-byte field elements.
 *
 * See docs/private-policies.md sections 4 (public inputs) and 5 (nullifier).
 */
import { createHash } from 'node:crypto';
import { Address } from '@stellar/stellar-sdk';

/** 1 USDC = 10,000,000 stroops. */
export const STROOPS_PER_USDC = 10_000_000n;

const FIELD_BYTES = 32;

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function assert32(name: string, b: Buffer): Buffer {
  if (b.length !== FIELD_BYTES) {
    throw new Error(`${name} must be exactly 32 bytes, got ${b.length}`);
  }
  return b;
}

/** Accept a 32-byte field element as a Buffer or a 64-char hex string. */
function toField(name: string, v: Buffer | string): Buffer {
  const b = typeof v === 'string' ? Buffer.from(v.replace(/^0x/, ''), 'hex') : v;
  return assert32(name, b);
}

/**
 * PI1: `SHA-256(payee ScVal XDR)`. Uses the Soroban `ScVal` (`SCV_ADDRESS`) XDR
 * of the address, matching the on-chain verifier's `payee.to_xdr(env)`.
 */
export function payeeHash(payeeAddress: string): Buffer {
  const scvalXdr = Address.fromString(payeeAddress).toScVal().toXDR(); // Buffer
  return sha256(scvalXdr);
}

/**
 * pp/2: the payee as a BLS12-381 scalar field element. The pp/1 `payeeHash`
 * (SHA-256 of the ScVal XDR) has its top 3 bits cleared so the value is always
 * `< 2^253 < r` (the BLS12-381 scalar modulus), making it a valid field element
 * without a big-integer reduction. The vault computes the identical value from
 * the on-chain `Address`, which is what binds a proof to the real payee.
 */
export function payeeField(payeeAddress: string): Buffer {
  const out = Buffer.from(payeeHash(payeeAddress));
  out[0] &= 0x1f;
  return out;
}

/**
 * pp/2: encode a non-negative integer (a u64 ledger time / count, or a u128
 * running-spend) as a 32-byte big-endian scalar. Used for the `now`,
 * `running_spend`, and `prior_count` public inputs the vault supplies.
 */
export function feScalar(value: bigint): Buffer {
  if (value < 0n) throw new Error('scalar must be non-negative');
  if (value >= 1n << 253n) throw new Error('scalar exceeds field capacity');
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

/**
 * PI2: `0x00 × 16 ‖ amount_u128.to_be_bytes()`, a 32-byte big-endian scalar.
 * `amountStroops` MUST be a positive integer (the verifier rejects `amount ≤ 0`).
 * In pp/2 this doubles as the `amount` field element (always `< 2^128 < r`).
 */
export function amountScalar(amountStroops: bigint): Buffer {
  if (amountStroops <= 0n) throw new Error('amount must be positive');
  if (amountStroops >= 1n << 128n) throw new Error('amount exceeds u128');
  const out = Buffer.alloc(FIELD_BYTES); // top 16 bytes stay zero
  out.writeBigUInt64BE(amountStroops >> 64n, 16);
  out.writeBigUInt64BE(amountStroops & 0xffffffffffffffffn, 24);
  return out;
}

/** Convert a USDC amount to stroops (rounded to the nearest stroop). */
export function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * Number(STROOPS_PER_USDC)));
}

export interface PublicInputs {
  /** PI0: policy commitment (Poseidon2 output, opaque here). */
  commitment: Buffer;
  /** PI1: SHA-256 of the payee ScVal XDR. */
  payeeHash: Buffer;
  /** PI2: 32-byte big-endian amount scalar. */
  amountScalar: Buffer;
  /** PI3: nullifier (Poseidon2 output, opaque here). */
  nullifier: Buffer;
  /** The 128-byte canonical vector PI0‖PI1‖PI2‖PI3. */
  vector: Buffer;
  /** SHA-256(vector): the binding hash carried in the proof header. */
  piHash: Buffer;
}

/**
 * Assemble the four public inputs and the binding `PI_hash` for a release.
 *
 * @param commitment PI0, a 32-byte field element (Buffer or hex).
 * @param payeeAddress the Stellar payee address (G...).
 * @param amountStroops the release amount in stroops.
 * @param nullifier PI3, a 32-byte field element (Buffer or hex).
 */
export function encodePublicInputs(
  commitment: Buffer | string,
  payeeAddress: string,
  amountStroops: bigint,
  nullifier: Buffer | string,
): PublicInputs {
  const pi0 = toField('commitment', commitment);
  const pi1 = payeeHash(payeeAddress);
  const pi2 = amountScalar(amountStroops);
  const pi3 = toField('nullifier', nullifier);
  const vector = Buffer.concat([pi0, pi1, pi2, pi3]);
  return {
    commitment: pi0,
    payeeHash: pi1,
    amountScalar: pi2,
    nullifier: pi3,
    vector,
    piHash: sha256(vector),
  };
}
