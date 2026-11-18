import { describe, it, expect } from 'vitest';
import {
  extractBatchOutputs,
  feBytes,
  g1ToSoroban,
  g2ToSoroban,
  proofToSoroban,
  publicSignalsToScalars,
  vkeyToSoroban,
} from './groth16-soroban.js';

describe('groth16 -> Soroban byte encoding', () => {
  it('feBytes is big-endian, zero-padded, and bounded', () => {
    expect(feBytes(0n, 32).toString('hex')).toBe('00'.repeat(32));
    expect(feBytes(1n, 32).toString('hex')).toBe('00'.repeat(31) + '01');
    expect(feBytes('255', 1).toString('hex')).toBe('ff');
    expect(() => feBytes(256n, 1)).toThrow();
    expect(() => feBytes(-1n, 32)).toThrow();
  });

  it('g1 is 96 bytes x||y', () => {
    const g1 = g1ToSoroban(['1', '2', '1']);
    expect(g1.length).toBe(96);
    expect(g1.subarray(47, 48).toString('hex')).toBe('01'); // end of x
    expect(g1.subarray(95, 96).toString('hex')).toBe('02'); // end of y
  });

  it('g2 is 192 bytes with each Fp2 reversed to c1||c0', () => {
    // x=[c0=1, c1=2], y=[c0=3, c1=4] -> bytes end in 02,01,04,03 per 48-byte limb.
    const g2 = g2ToSoroban([
      ['1', '2'],
      ['3', '4'],
      ['1', '0'],
    ]);
    expect(g2.length).toBe(192);
    expect(g2.subarray(47, 48).toString('hex')).toBe('02'); // x.c1 first
    expect(g2.subarray(95, 96).toString('hex')).toBe('01'); // x.c0 second
    expect(g2.subarray(143, 144).toString('hex')).toBe('04'); // y.c1
    expect(g2.subarray(191, 192).toString('hex')).toBe('03'); // y.c0
  });

  it('proofToSoroban yields 96/192/96 byte components', () => {
    const p = proofToSoroban({
      pi_a: ['1', '2', '1'],
      pi_b: [
        ['1', '2'],
        ['3', '4'],
        ['1', '0'],
      ],
      pi_c: ['5', '6', '1'],
    });
    expect(p.a.length).toBe(96);
    expect(p.b.length).toBe(192);
    expect(p.c.length).toBe(96);
  });

  it('vkeyToSoroban maps all components and IC', () => {
    const vk = vkeyToSoroban({
      vk_alpha_1: ['1', '2', '1'],
      vk_beta_2: [
        ['1', '2'],
        ['3', '4'],
        ['1', '0'],
      ],
      vk_gamma_2: [
        ['1', '2'],
        ['3', '4'],
        ['1', '0'],
      ],
      vk_delta_2: [
        ['1', '2'],
        ['3', '4'],
        ['1', '0'],
      ],
      IC: [
        ['1', '2', '1'],
        ['3', '4', '1'],
      ],
    });
    expect(vk.alphaG1.length).toBe(96);
    expect(vk.betaG2.length).toBe(192);
    expect(vk.ic).toHaveLength(2);
    expect(vk.ic[0].length).toBe(96);
  });

  it('publicSignalsToScalars returns 32-byte scalars', () => {
    const s = publicSignalsToScalars(['0', '1', '1500']);
    expect(s).toHaveLength(3);
    expect(s.every((b) => b.length === 32)).toBe(true);
    expect(s[2].toString('hex').endsWith('05dc')).toBe(true); // 1500 = 0x5dc
  });

  it('extractBatchOutputs pulls commitment + nullifiers (active = non-zero leading)', () => {
    // [commitment, n0, n1, n2, n3, ...rest] with n2,n3 zero (null slots).
    const signals = ['7', '11', '22', '0', '0', '99', '0', '0', '0'];
    const { commitment, nullifiers, activeNullifiers } = extractBatchOutputs(signals, 4);
    expect(commitment.toString('hex').endsWith('07')).toBe(true);
    expect(nullifiers).toHaveLength(4);
    expect(activeNullifiers).toHaveLength(2);
    expect(activeNullifiers[0].toString('hex').endsWith('0b')).toBe(true); // 11
    expect(activeNullifiers[1].toString('hex').endsWith('16')).toBe(true); // 22
  });

  it('extractBatchOutputs rejects too few signals', () => {
    expect(() => extractBatchOutputs(['1', '2'], 4)).toThrow();
  });
});
