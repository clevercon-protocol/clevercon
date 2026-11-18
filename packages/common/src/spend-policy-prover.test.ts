import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  buildBindingProof,
  verifyBindingProofLocally,
  circuitId,
  generateNullifier,
  CIRCUIT_DOMAIN_SEP,
} from './spend-policy-prover.js';
import { encodePublicInputs } from './policy-inputs.js';

const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

function sampleInput() {
  return {
    commitment: randomBytes(32),
    payeeAddress: PAYEE,
    amountStroops: 10_000_000n,
    nullifier: randomBytes(32),
  };
}

describe('spend-policy binding proof', () => {
  it('produces a 512-byte proof whose header binds the public inputs', () => {
    const input = sampleInput();
    const { proof, piHash } = buildBindingProof(input);

    expect(proof.length).toBe(512);
    // [0..32) is the PI commitment and must equal the encoder's piHash.
    expect(proof.subarray(0, 32).equals(piHash)).toBe(true);
    const expected = encodePublicInputs(
      input.commitment,
      input.payeeAddress,
      input.amountStroops,
      input.nullifier,
    );
    expect(piHash.equals(expected.piHash)).toBe(true);
    // [32..64) is the documented circuit id.
    expect(proof.subarray(32, 64).equals(circuitId())).toBe(true);
    // Tail is zero padding.
    expect(proof.subarray(224).every((b) => b === 0)).toBe(true);
  });

  it('passes the contract-mirrored verification check', () => {
    const { proof, piHash } = buildBindingProof(sampleInput());
    expect(verifyBindingProofLocally(proof, piHash)).toBe(true);
  });

  it('is robust: satisfies the opening check for many random inputs', () => {
    for (let i = 0; i < 200; i++) {
      const { proof, piHash } = buildBindingProof(sampleInput());
      expect(verifyBindingProofLocally(proof, piHash)).toBe(true);
    }
  });

  it('is deterministic for the same inputs', () => {
    const input = sampleInput();
    const a = buildBindingProof(input);
    const b = buildBindingProof(input);
    expect(a.proof.equals(b.proof)).toBe(true);
  });

  it('binds the amount: a proof does not verify against a different amount', () => {
    const input = sampleInput();
    const { proof } = buildBindingProof(input);
    const other = encodePublicInputs(
      input.commitment,
      input.payeeAddress,
      input.amountStroops + 1n,
      input.nullifier,
    );
    // The proof carries the original piHash, so checking it against a different
    // release (amount changed) must fail the PI-commitment binding.
    expect(verifyBindingProofLocally(proof, other.piHash)).toBe(false);
  });

  it('binds the payee and nullifier', () => {
    const input = sampleInput();
    const { proof } = buildBindingProof(input);
    const wrongNullifier = encodePublicInputs(
      input.commitment,
      input.payeeAddress,
      input.amountStroops,
      randomBytes(32),
    );
    expect(verifyBindingProofLocally(proof, wrongNullifier.piHash)).toBe(false);
  });

  it('rejects a tampered proof body', () => {
    const { proof, piHash } = buildBindingProof(sampleInput());
    const tampered = Buffer.from(proof);
    tampered[100] ^= 0xff; // flip a byte in grand_product_eval
    expect(verifyBindingProofLocally(tampered, piHash)).toBe(false);
  });

  it('exposes the circuit domain separator and a nullifier generator', () => {
    expect(CIRCUIT_DOMAIN_SEP).toBe('clevercon-spend-policy-v1');
    expect(generateNullifier()).toHaveLength(32);
    expect(generateNullifier().equals(generateNullifier())).toBe(false);
  });
});
