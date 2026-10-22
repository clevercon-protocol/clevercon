/**
 * Self-contained encoders for the pp/2 private-policy wire format, so the SDK has
 * no workspace dependency. These mirror `@clevercon/common`'s `policy-inputs` and
 * `groth16-soroban` (which the zk-fixture CI proves end to end); keep them in sync.
 *
 * Fp = 48 bytes, G1 = 96 (x||y), G2 = 192, scalar = 32, all big-endian. G2 Fp2
 * limbs are emitted c1 || c0 (snarkjs stores [c0, c1]; Soroban wants them
 * reversed). payee_field = SHA-256(ScVal XDR) with the top 3 bits cleared.
 */
import { Address, hash } from '@stellar/stellar-sdk';

const FP = 48;
const FR = 32;

// SHA-256 via stellar-sdk (same bytes as node:crypto's createHash) so this module
// works in the browser too: stellar-sdk is already browser-bundled, and avoiding
// node:crypto lets the dapp import the prover without a Node polyfill.
function sha256(buf: Buffer): Buffer {
  return Buffer.from(hash(buf));
}

/** A non-negative integer (decimal string or bigint) as a big-endian field element. */
export function feBytes(value: string | bigint, nbytes: number): Buffer {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('field element must be non-negative');
  const hex = v.toString(16);
  if (hex.length > nbytes * 2) throw new Error(`value exceeds ${nbytes} bytes`);
  return Buffer.from(hex.padStart(nbytes * 2, '0'), 'hex');
}

/**
 * The payee as a BLS12-381 scalar: SHA-256 of the address's ScVal XDR with the
 * top 3 bits cleared (< 2^253 < r). The vault computes the identical value from
 * the on-chain Address, binding a proof to the real payee.
 */
export function payeeField(payeeAddress: string): Buffer {
  const scvalXdr = Address.fromString(payeeAddress).toScVal().toXDR();
  const out = sha256(scvalXdr);
  out[0] &= 0x1f;
  return out;
}

/** `0x00 × 16 || amount_u128` (32 bytes), the circuit's `amount` scalar. */
export function amountScalar(amountStroops: bigint): Buffer {
  if (amountStroops <= 0n) throw new Error('amount must be positive');
  if (amountStroops >= 1n << 128n) throw new Error('amount exceeds u128');
  const out = Buffer.alloc(FR);
  out.writeBigUInt64BE(amountStroops >> 64n, 16);
  out.writeBigUInt64BE(amountStroops & 0xffffffffffffffffn, 24);
  return out;
}

/** A non-negative integer (ledger time / count / spend) as a 32-byte scalar. */
export function feScalar(value: bigint): Buffer {
  if (value < 0n) throw new Error('scalar must be non-negative');
  if (value >= 1n << 253n) throw new Error('scalar exceeds field capacity');
  return feBytes(value, FR);
}

/** snarkjs G1 `[x, y, 1]` -> 96 bytes `x || y`. */
export function g1ToSoroban(p: readonly string[]): Buffer {
  return Buffer.concat([feBytes(p[0], FP), feBytes(p[1], FP)]);
}

/** snarkjs G2 -> 192 bytes with each Fp2 reversed to c1||c0. */
export function g2ToSoroban(p: readonly (readonly string[])[]): Buffer {
  return Buffer.concat([
    feBytes(p[0][1], FP),
    feBytes(p[0][0], FP),
    feBytes(p[1][1], FP),
    feBytes(p[1][0], FP),
  ]);
}

export interface SorobanProof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}

/** Convert a snarkjs `proof.json` to the vault's `Groth16Proof` bytes. */
export function proofToSoroban(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): SorobanProof {
  return {
    a: g1ToSoroban(proof.pi_a),
    b: g2ToSoroban(proof.pi_b),
    c: g1ToSoroban(proof.pi_c),
  };
}

/**
 * Pull the batch outputs from the public signals. snarkjs orders them outputs
 * then inputs, so `signals[0]` is the commitment, `signals[1..1+n]` the `n`
 * nullifiers (active slots first), and `signals[1+n]` / `signals[2+n]` the
 * tumbling-window reset flags for R2 / R7. `activeNullifiers` keeps the non-zero
 * ones.
 */
export function extractBatchOutputs(
  signals: string[],
  n: number,
): {
  commitment: Buffer;
  nullifiers: Buffer[];
  activeNullifiers: Buffer[];
  resetR2: boolean;
  resetR7: boolean;
} {
  if (signals.length < 3 + n) {
    throw new Error(`expected at least ${3 + n} public signals, got ${signals.length}`);
  }
  const commitment = feBytes(signals[0], FR);
  const nullifiers = signals.slice(1, 1 + n).map((s) => feBytes(s, FR));
  const activeNullifiers = nullifiers.filter((nf) => !nf.every((b) => b === 0));
  const resetR2 = signals[1 + n] === '1';
  const resetR7 = signals[2 + n] === '1';
  return { commitment, nullifiers, activeNullifiers, resetR2, resetR7 };
}
