import { describe, it, expect } from 'vitest';
import { buildPrivateDisbursement } from './private-disburse.js';
import { policyCommitment } from './batch-prover.js';
import { policyWitnessFromBundle } from './policy-bundle.js';

const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const ART = { wasmPath: 'unused.wasm', zkeyPath: 'unused.zkey' };

// These reject BEFORE any proving, so they need no circuit artifacts.
describe('buildPrivateDisbursement validation', () => {
  it('rejects a bundle without a salt', async () => {
    await expect(
      buildPrivateDisbursement(
        { rules: { perPaymentCeilingUsdc: 10 }, salt: '' },
        [{ payee: PAYEE, amount: 1 }],
        ART,
      ),
    ).rejects.toThrow(/rules.*salt|salt/);
  });

  it('rejects 0 or more than 4 lines', async () => {
    const bundle = { rules: { perPaymentCeilingUsdc: 10 }, salt: '123' };
    await expect(buildPrivateDisbursement(bundle, [], ART)).rejects.toThrow(/1\.\.4/);
    const five = Array.from({ length: 5 }, () => ({ payee: PAYEE, amount: 1 }));
    await expect(buildPrivateDisbursement(bundle, five, ART)).rejects.toThrow(/1\.\.4/);
  });
});

// The disbursement's commitment must equal the canonical pinnable commitment, so a
// prior `set_policy_commitment` admits the release. Needs the circuit artifacts.
const PP2_WASM = process.env.PP2_WASM;
const PP2_ZKEY = process.env.PP2_ZKEY;
describe.skipIf(!PP2_WASM || !PP2_ZKEY)('buildPrivateDisbursement proving', () => {
  it('produces a request whose commitment matches policyCommitment', async () => {
    const bundle = { rules: { perPaymentCeilingUsdc: 100 }, salt: '424242' };
    const { request, totalUsdc, commitmentHex } = await buildPrivateDisbursement(
      bundle,
      [{ payee: PAYEE, amount: 5 }],
      { wasmPath: PP2_WASM as string, zkeyPath: PP2_ZKEY as string },
    );
    expect(request.payees).toEqual([PAYEE]);
    expect(request.nullifiers.length).toBe(1);
    expect(totalUsdc).toBe(5);
    const expected = (
      await policyCommitment(policyWitnessFromBundle(bundle), { wasmPath: PP2_WASM as string })
    ).toString('hex');
    expect(commitmentHex).toBe(expected);
  }, 120_000);
});
