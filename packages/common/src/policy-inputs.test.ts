import { describe, it, expect } from 'vitest';
import { amountScalar, encodePublicInputs, payeeHash, usdcToStroops } from './policy-inputs.js';

// The canonical fixture from docs/private-policies.md section 11.
const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const COMMITMENT = '0a'.repeat(32);
const NULLIFIER = '0b'.repeat(32);
const AMOUNT_STROOPS = 1_500_000n; // 0.15 USDC

const EXPECT = {
  payeeHash: '3f8dde2a43b0e39285c73fa275da29bd739ac0a93049a60e98de0ac7f92faa2c',
  amountScalar: '000000000000000000000000000000000000000000000000000000000016e360',
  piHash: 'cad880678d1eac3ddba11b732ccfe41dd0596fecc5b603e1d9a63f1446999399',
};

describe('policy public-input encoding (docs/private-policies.md pp/1)', () => {
  it('matches the frozen worked-example fixture byte-for-byte', () => {
    const pi = encodePublicInputs(COMMITMENT, PAYEE, AMOUNT_STROOPS, NULLIFIER);
    expect(pi.payeeHash.toString('hex')).toBe(EXPECT.payeeHash);
    expect(pi.amountScalar.toString('hex')).toBe(EXPECT.amountScalar);
    expect(pi.piHash.toString('hex')).toBe(EXPECT.piHash);
    expect(pi.vector.length).toBe(128);
    expect(pi.commitment.toString('hex')).toBe(COMMITMENT);
    expect(pi.nullifier.toString('hex')).toBe(NULLIFIER);
  });

  it('accepts field elements as Buffers too', () => {
    const pi = encodePublicInputs(
      Buffer.from(COMMITMENT, 'hex'),
      PAYEE,
      AMOUNT_STROOPS,
      Buffer.from(NULLIFIER, 'hex'),
    );
    expect(pi.piHash.toString('hex')).toBe(EXPECT.piHash);
  });

  it('amount_scalar is 16 zero bytes then the u128 big-endian amount', () => {
    expect(amountScalar(1n).toString('hex')).toBe('00'.repeat(31) + '01');
    // 0x16e360 == 1_500_000
    expect(amountScalar(1_500_000n).toString('hex').endsWith('16e360')).toBe(true);
    expect(amountScalar(1n).length).toBe(32);
  });

  it('rejects non-positive and oversized amounts', () => {
    expect(() => amountScalar(0n)).toThrow();
    expect(() => amountScalar(-1n)).toThrow();
    expect(() => amountScalar(1n << 128n)).toThrow();
  });

  it('rejects mis-sized field elements', () => {
    expect(() => encodePublicInputs('00', PAYEE, AMOUNT_STROOPS, NULLIFIER)).toThrow();
    expect(() => encodePublicInputs(COMMITMENT, PAYEE, AMOUNT_STROOPS, 'dead')).toThrow();
  });

  it('payeeHash is deterministic and 32 bytes', () => {
    const a = payeeHash(PAYEE);
    const b = payeeHash(PAYEE);
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
  });

  it('usdcToStroops converts at 1e7', () => {
    expect(usdcToStroops(0.15)).toBe(1_500_000n);
    expect(usdcToStroops(1)).toBe(10_000_000n);
  });
});
