/**
 * Encode a snarkjs BLS12-381 Groth16 proof / verifying key into the uncompressed
 * byte form the Soroban policy-verifier and vault expect, and pull the batch
 * outputs (commitment + nullifiers) out of the public signals.
 *
 * This is the client-side counterpart of `scripts/zk/gen-fixture.mjs` (which the
 * zk-fixture CI proves end to end): the SDK prover uses it to turn a proof into
 * the `Groth16Proof` and `release_payment_proved_batch` arguments the vault takes.
 *
 * Sizes: Fp = 48 bytes, G1 = 96 (x||y), G2 = 192, scalar (Fr) = 32, all
 * big-endian. G2 Fp2 coordinates are emitted c1 || c0 (snarkjs stores [c0, c1];
 * Soroban's encoding wants the limbs reversed), the one gotcha the CI pinned.
 */
const FP = 48;
const FR = 32;

/** A non-negative integer (decimal string or bigint) as a big-endian field element. */
export function feBytes(value: string | bigint, nbytes: number): Buffer {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('field element must be non-negative');
  const hex = v.toString(16);
  if (hex.length > nbytes * 2) throw new Error(`value exceeds ${nbytes} bytes`);
  return Buffer.from(hex.padStart(nbytes * 2, '0'), 'hex');
}

/** snarkjs G1 `[x, y, 1]` -> 96 bytes `x || y`. */
export function g1ToSoroban(p: readonly string[]): Buffer {
  return Buffer.concat([feBytes(p[0], FP), feBytes(p[1], FP)]);
}

/** snarkjs G2 `[[x_c0, x_c1], [y_c0, y_c1], ...]` -> 192 bytes `x.c1||x.c0||y.c1||y.c0`. */
export function g2ToSoroban(p: readonly (readonly string[])[]): Buffer {
  return Buffer.concat([
    feBytes(p[0][1], FP),
    feBytes(p[0][0], FP),
    feBytes(p[1][1], FP),
    feBytes(p[1][0], FP),
  ]);
}

export interface SorobanVk {
  alphaG1: Buffer;
  betaG2: Buffer;
  gammaG2: Buffer;
  deltaG2: Buffer;
  ic: Buffer[];
}

/** Convert a snarkjs `verification_key.json` to Soroban VK bytes. */
export function vkeyToSoroban(vkey: {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}): SorobanVk {
  return {
    alphaG1: g1ToSoroban(vkey.vk_alpha_1),
    betaG2: g2ToSoroban(vkey.vk_beta_2),
    gammaG2: g2ToSoroban(vkey.vk_gamma_2),
    deltaG2: g2ToSoroban(vkey.vk_delta_2),
    ic: vkey.IC.map(g1ToSoroban),
  };
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

/** Every public signal (decimal strings) as a 32-byte big-endian scalar. */
export function publicSignalsToScalars(signals: string[]): Buffer[] {
  return signals.map((s) => feBytes(s, FR));
}

/**
 * Pull the batch circuit's outputs from its public signals. snarkjs orders public
 * signals as outputs then inputs, so `signals[0]` is the commitment and
 * `signals[1..1+n]` are the `n` nullifiers (active slots first, trailing null
 * slots are zero). `activeCount` returns only the leading non-zero nullifiers,
 * which are the releases the vault actually settles.
 */
export function extractBatchOutputs(
  signals: string[],
  n: number,
): { commitment: Buffer; nullifiers: Buffer[]; activeNullifiers: Buffer[] } {
  if (signals.length < 1 + n) {
    throw new Error(`expected at least ${1 + n} public signals, got ${signals.length}`);
  }
  const commitment = feBytes(signals[0], FR);
  const nullifiers = signals.slice(1, 1 + n).map((s) => feBytes(s, FR));
  const activeNullifiers = nullifiers.filter((nf) => !nf.every((b) => b === 0));
  return { commitment, nullifiers, activeNullifiers };
}
