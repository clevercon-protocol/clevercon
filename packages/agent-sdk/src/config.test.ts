import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { resolveConfig, buildManifest, AgentConfigError } from './config.js';
import type { AgentConfig } from './types.js';

const SECRET = Keypair.random().secret();

function base(): AgentConfig {
  return {
    manifest: { agent_id: 'demo', name: 'Demo', description: 'A demo agent' },
    capabilities: ['demo'],
    price: 0.02,
    payment: 'x402',
    handler: () => ({ ok: true }),
    wallet: { secretKey: SECRET },
  };
}

describe('resolveConfig', () => {
  it('accepts a minimal valid config and derives the public key', () => {
    const resolved = resolveConfig(base());
    expect(resolved.publicKey).toBe(Keypair.fromSecret(SECRET).publicKey());
    expect(resolved.taskPath).toBe('/query');
    expect(resolved.currency).toBe('USDC');
    expect(resolved.realm).toBe('clevercon-demo');
  });

  it.each([
    ['missing manifest', { manifest: undefined }, /manifest is required/],
    ['missing manifest.name', { manifest: { agent_id: 'x', description: 'y' } }, /manifest\.name/],
    ['empty capabilities', { capabilities: [] }, /non-empty/],
    ['zero price', { price: 0 }, /positive number/],
    ['negative price', { price: -1 }, /positive number/],
    ['bad payment', { payment: 'card' }, /x402.*mpp/],
    ['missing handler', { handler: undefined }, /handler must be a function/],
    ['missing secret', { wallet: {} }, /wallet\.secretKey is required/],
    ['bad secret', { wallet: { secretKey: 'nope' } }, /not a valid Stellar secret/],
    ['bad taskPath', { taskPath: 'query' }, /must start with/],
  ])('fails fast: %s', (_label, patch, message) => {
    expect(() => resolveConfig({ ...base(), ...(patch as Partial<AgentConfig>) })).toThrow(
      AgentConfigError,
    );
    expect(() => resolveConfig({ ...base(), ...(patch as Partial<AgentConfig>) })).toThrow(message);
  });
});

describe('buildManifest', () => {
  it('produces the registry payload shape the agents send today', () => {
    const manifest = buildManifest(resolveConfig(base()), 'http://localhost:4001/');
    expect(manifest).toEqual({
      agent_id: 'demo',
      name: 'Demo',
      description: 'A demo agent',
      capabilities: ['demo'],
      pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
      endpoint: 'http://localhost:4001/query',
      stellar_address: Keypair.fromSecret(SECRET).publicKey(),
      health_check: 'http://localhost:4001/health',
    });
  });
});
