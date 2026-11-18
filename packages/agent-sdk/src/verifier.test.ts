import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyResult, validateSchema, resultSigningPayload } from './verifier.js';
import type { ServiceManifest, JobResultEnvelope, VerificationSpec } from './marketplace.js';

function manifest(
  verification: VerificationSpec,
  output: Record<string, unknown> = {},
): ServiceManifest {
  return {
    id: 's',
    name: 's',
    category: 'c',
    tier: 'T1',
    description: '',
    capabilities: [],
    pricing: { model: 'direct', pricePerCall: 0.05, currency: 'USDC' },
    payout: 'G',
    io: { input: {}, output },
    verification,
    version: 1,
  };
}

const envelope = (over: Partial<JobResultEnvelope> = {}): JobResultEnvelope => ({
  ok: true,
  contentType: 'application/json',
  issuedAt: 1760000000,
  ...over,
});

describe('validateSchema', () => {
  it('passes a valid object and rejects a missing required field or wrong type', () => {
    const schema = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } };
    expect(validateSchema({ n: 7 }, schema).ok).toBe(true);
    expect(validateSchema({}, schema).ok).toBe(false);
    expect(validateSchema({ n: 'x' }, schema).ok).toBe(false);
  });
});

describe('verifyResult', () => {
  it('rejects a not-ok delivery', async () => {
    const r = await verifyResult(
      manifest({ method: 'attest' }),
      {},
      envelope({ ok: false, error: 'boom' }),
    );
    expect(r.ok).toBe(false);
  });

  it('content-hash: matches the requested hash and rejects a mismatch', async () => {
    const m = manifest({ method: 'content-hash' });
    const ok = await verifyResult(
      m,
      { hash: 'sha256:abc' },
      envelope({
        artifact: { url: 'u', hash: 'sha256:abc', contentType: 'image/png', size: 1 },
      }),
    );
    expect(ok.ok).toBe(true);
    const bad = await verifyResult(
      m,
      { hash: 'sha256:abc' },
      envelope({
        artifact: { url: 'u', hash: 'sha256:xyz', contentType: 'image/png', size: 1 },
      }),
    );
    expect(bad.ok).toBe(false);
  });

  it('signature: verifies a real provider signature and rejects tampering', async () => {
    const kp = Keypair.random();
    const m = manifest({ method: 'signature', spec: { signerKey: kp.publicKey() } });
    const out = envelope({ data: { answer: 42 } });
    const sig = kp.sign(Buffer.from(resultSigningPayload(out))).toString('base64');
    out.signature = sig;
    expect((await verifyResult(m, {}, out)).ok).toBe(true);
    // Tamper with the data after signing: verification must fail.
    const tampered = { ...out, data: { answer: 43 } };
    expect((await verifyResult(m, {}, tampered)).ok).toBe(false);
  });

  it('witness(product): accepts correct factors and rejects wrong ones', async () => {
    const m = manifest({ method: 'witness', spec: { predicate: 'product' } });
    expect((await verifyResult(m, { n: 15 }, envelope({ data: { a: 3, b: 5 } }))).ok).toBe(true);
    expect((await verifyResult(m, { n: 15 }, envelope({ data: { a: 3, b: 4 } }))).ok).toBe(false);
  });

  it('onchain: fails without a deriver, passes when the re-derivation matches', async () => {
    const m = manifest({ method: 'onchain' });
    const out = envelope({ data: { balance: '100' } });
    expect((await verifyResult(m, { address: 'G' }, out)).ok).toBe(false);
    const ok = await verifyResult(m, { address: 'G' }, out, { derive: () => ({ balance: '100' }) });
    expect(ok.ok).toBe(true);
    const bad = await verifyResult(m, { address: 'G' }, out, { derive: () => ({ balance: '99' }) });
    expect(bad.ok).toBe(false);
  });

  it('attest: falls back to a structural schema check', async () => {
    const m = manifest({ method: 'attest' }, { type: 'object', required: ['summary'] });
    expect((await verifyResult(m, {}, envelope({ data: { summary: 'hi' } }))).ok).toBe(true);
    expect((await verifyResult(m, {}, envelope({ data: {} }))).ok).toBe(false);
  });
});
