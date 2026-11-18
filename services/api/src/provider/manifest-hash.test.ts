import { describe, it, expect } from 'vitest';
import { manifestHash } from './provider.service.js';

const base = {
  name: 'Stellar Oracle',
  description: 'Live price data',
  category: 'Data & Oracles',
  capabilities: ['price', 'history'],
  pricingModel: 'X402',
  pricePerCall: 0.05,
  endpoint: 'https://oracle.example.com',
  stellarAddress: 'GPROVIDER',
};

describe('manifestHash', () => {
  it('is a 32-byte hex digest', () => {
    expect(manifestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and order-independent for capabilities', () => {
    const a = manifestHash(base);
    const b = manifestHash({ ...base, capabilities: ['history', 'price'] });
    expect(b).toBe(a);
  });

  it('changes when any published field changes', () => {
    const a = manifestHash(base);
    expect(manifestHash({ ...base, pricePerCall: 0.06 })).not.toBe(a);
    expect(manifestHash({ ...base, endpoint: 'https://evil.example.com' })).not.toBe(a);
    expect(manifestHash({ ...base, stellarAddress: 'GATTACKER' })).not.toBe(a);
    expect(manifestHash({ ...base, name: 'Renamed' })).not.toBe(a);
  });

  it('treats a string and numeric price identically (stable serialization)', () => {
    expect(manifestHash({ ...base, pricePerCall: '0.05' })).toBe(manifestHash(base));
  });
});
