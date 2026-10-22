import { describe, it, expect } from 'vitest';
import {
  amountScalar,
  extractBatchOutputs,
  feScalar,
  g2ToSoroban,
  payeeField,
  proofToSoroban,
} from './policy-codec.js';
import {
  ALLOWLIST_DEPTH,
  BATCH_N,
  buildBatchReleaseRequest,
  buildBatchWitness,
  createBatchProof,
  policyCommitment,
  type BatchContext,
  type BatchProof,
  type BatchRelease,
  type PolicyWitness,
} from './batch-prover.js';
import { policyWitnessFromBundle } from './policy-bundle.js';

const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('policy-codec (SDK, mirrors @clevercon/common)', () => {
  it('payeeField masks the top 3 bits of SHA-256(ScVal XDR)', () => {
    expect(payeeField(PAYEE).toString('hex')).toBe(
      '1f8dde2a43b0e39285c73fa275da29bd739ac0a93049a60e98de0ac7f92faa2c',
    );
    expect(payeeField(PAYEE)[0] & 0xe0).toBe(0);
  });

  it('amountScalar and feScalar are 32-byte big-endian', () => {
    expect(amountScalar(1_500_000n).toString('hex').endsWith('16e360')).toBe(true);
    expect(feScalar(0n).toString('hex')).toBe('00'.repeat(32));
    expect(feScalar(1500n).toString('hex').endsWith('05dc')).toBe(true);
  });

  it('g2ToSoroban reverses each Fp2 to c1||c0 and is 192 bytes', () => {
    const g2 = g2ToSoroban([
      ['1', '2'],
      ['3', '4'],
      ['1', '0'],
    ]);
    expect(g2.length).toBe(192);
    expect(g2.subarray(47, 48).toString('hex')).toBe('02');
    expect(g2.subarray(95, 96).toString('hex')).toBe('01');
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

  it('extractBatchOutputs splits commitment and active nullifiers', () => {
    const signals = ['7', '11', '22', '0', '0', '99'];
    const { commitment, nullifiers, activeNullifiers } = extractBatchOutputs(signals, 4);
    expect(commitment.toString('hex').endsWith('07')).toBe(true);
    expect(nullifiers).toHaveLength(4);
    expect(activeNullifiers).toHaveLength(2);
  });
});

function samplePolicy(): PolicyWitness {
  return {
    enabled: [true, true, true, true, true, true, true, true],
    salt: '123',
    r1Ceiling: '100',
    r2Cap: '200',
    r2WindowSecs: '86400',
    r2Delegate: '0',
    r3Root: '555',
    r3Depth: '16',
    r4Entries: ['1', '2', '3', '4'],
    r4Threshold: '50',
    r6WindowsRoot: '777',
    r6Windows: [
      { start: '1000', end: '2000' },
      { start: '5000', end: '6000' },
    ],
    r7MaxCount: '10',
    r7WindowSecs: '86400',
    r8CatCeilings: ['1000', '0', '0', '0'],
    disclosureTag: '0',
  };
}

describe('buildBatchWitness', () => {
  const ctx: BatchContext = {
    validAfter: '1200',
    validBefore: '1800',
    runningSpend: '0',
    priorCount: '0',
  };

  it('pads to BATCH_N with null slots and shapes every array', () => {
    const releases: BatchRelease[] = [
      { payeeAddress: PAYEE, amountStroops: '60', spendCounter: '0' },
      { payeeAddress: PAYEE, amountStroops: '30', spendCounter: '1' },
    ];
    const w = buildBatchWitness(samplePolicy(), releases, ctx) as Record<string, unknown>;

    expect((w.payee_field as string[]).length).toBe(BATCH_N);
    expect(w.active as string[]).toEqual(['1', '1', '0', '0']);
    expect(w.amount as string[]).toEqual(['60', '30', '0', '0']);
    // Active payee_field is the decimal of payeeField(addr); null slots are 0.
    expect((w.payee_field as string[])[0]).toBe(
      BigInt('0x' + payeeField(PAYEE).toString('hex')).toString(),
    );
    expect((w.payee_field as string[])[2]).toBe('0');
    // Each release carries a full-depth path.
    expect((w.r3_path as string[][]).length).toBe(BATCH_N);
    expect((w.r3_path as string[][])[0].length).toBe(ALLOWLIST_DEPTH);
    // Public context + flags are carried through.
    expect(w.valid_after).toBe('1200');
    expect(w.valid_before).toBe('1800');
    expect(w.en as string[]).toEqual(['1', '1', '1', '1', '1', '1', '1', '1']);
    expect(w.r6_win_start as string[]).toEqual(['1000', '5000']);
  });

  it('rejects an empty or oversized batch', () => {
    expect(() => buildBatchWitness(samplePolicy(), [], ctx)).toThrow();
    const five: BatchRelease[] = Array.from({ length: 5 }, (_, i) => ({
      payeeAddress: PAYEE,
      amountStroops: '1',
      spendCounter: String(i),
    }));
    expect(() => buildBatchWitness(samplePolicy(), five, ctx)).toThrow();
  });
});

describe('buildBatchReleaseRequest', () => {
  const ctx: BatchContext = {
    validAfter: '0',
    validBefore: '9999',
    runningSpend: '0',
    priorCount: '0',
  };
  const proof: BatchProof = {
    proof: { a: Buffer.alloc(96, 1), b: Buffer.alloc(192, 2), c: Buffer.alloc(96, 3) },
    commitment: Buffer.alloc(32, 0xaa),
    nullifiers: [Buffer.alloc(32, 0xbb), Buffer.alloc(32, 0xcc)],
    publicSignals: [],
  };

  it('converts a proof + releases into the API relay request', () => {
    const releases: BatchRelease[] = [
      { payeeAddress: PAYEE, amountStroops: '60', spendCounter: '0' },
      { payeeAddress: PAYEE, amountStroops: '30', spendCounter: '1' },
    ];
    const req = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: 10,
      stepId: 2,
    });
    expect(req.vaultTaskId).toBe(null);
    expect(req.planCostUsdc).toBe(10);
    expect(req.stepId).toBe(2);
    expect(req.payees).toEqual([PAYEE, PAYEE]);
    expect(req.amounts).toEqual(['60', '30']);
    expect(req.nullifiers).toEqual(['bb'.repeat(32), 'cc'.repeat(32)]);
    expect(req.commitment).toBe('aa'.repeat(32));
    expect(req.proof.a).toBe('01'.repeat(96));
    expect(req.proof.b).toBe('02'.repeat(192));
    expect(req.proof.c).toBe('03'.repeat(96));
    expect(req.validAfter).toBe('0');
    expect(req.validBefore).toBe('9999');
  });

  it('rejects a release/nullifier length mismatch', () => {
    const oneNullifier: BatchProof = { ...proof, nullifiers: [Buffer.alloc(32, 0xbb)] };
    const releases: BatchRelease[] = [
      { payeeAddress: PAYEE, amountStroops: '1', spendCounter: '0' },
      { payeeAddress: PAYEE, amountStroops: '2', spendCounter: '1' },
    ];
    expect(() =>
      buildBatchReleaseRequest(oneNullifier, releases, ctx, {
        vaultTaskId: null,
        planCostUsdc: 1,
        stepId: 1,
      }),
    ).toThrow();
  });
});

// The commitment twin must produce the EXACT bytes the circuit outputs, since the
// vault stores and the owner pins that value and every disburse proof must
// reproduce it. Cross-checked against a real Groth16 proof. Needs the circuit
// artifacts, so it is gated on PP2_WASM + PP2_ZKEY (set them to the built
// policy_batch.wasm / policy_batch_final.zkey); skipped in CI without them.
const PP2_WASM = process.env.PP2_WASM;
const PP2_ZKEY = process.env.PP2_ZKEY;
describe.skipIf(!PP2_WASM || !PP2_ZKEY)('policyCommitment matches the circuit', () => {
  it('equals createBatchProof().commitment for the same policy + salt', async () => {
    const policy = policyWitnessFromBundle({
      rules: { perPaymentCeilingUsdc: 100 },
      salt: '123456789',
    });
    const releases: BatchRelease[] = [
      { payeeAddress: PAYEE, amountStroops: '500000000', spendCounter: '7' }, // 50 USDC < ceiling
    ];
    const ctx: BatchContext = {
      validAfter: '0',
      validBefore: '4294967295',
      runningSpend: '0',
      priorCount: '0',
    };
    const proof = await createBatchProof(policy, releases, ctx, {
      wasmPath: PP2_WASM as string,
      zkeyPath: PP2_ZKEY as string,
    });
    const commit = await policyCommitment(policy, { wasmPath: PP2_WASM as string });
    expect(commit.toString('hex')).toBe(proof.commitment.toString('hex'));
  }, 120_000);
});
