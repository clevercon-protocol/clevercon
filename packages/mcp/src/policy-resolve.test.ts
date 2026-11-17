import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveConfiguredPolicyId, _resetConfiguredPolicyCache } from './policy-resolve.js';
import type { ApiClient } from './api-client.js';

function fakeClient(items: { id: string; commitment: string; status: string }[] = []) {
  const get = vi.fn(async () => ({ items }));
  return { client: { get, post: vi.fn() } as unknown as ApiClient, get };
}

const POLICY_ENVS = [
  'CLEVERCON_POLICY_ID',
  'CLEVERCON_POLICY_KEY',
  'CLEVERCON_POLICY_JSON',
  'CLEVERCON_POLICY_FILE',
];

describe('resolveConfiguredPolicyId', () => {
  beforeEach(() => {
    _resetConfiguredPolicyCache();
    for (const k of POLICY_ENVS) delete process.env[k];
  });
  afterEach(() => {
    _resetConfiguredPolicyCache();
    for (const k of POLICY_ENVS) delete process.env[k];
  });

  it('uses CLEVERCON_POLICY_ID directly, without listing policies', async () => {
    process.env.CLEVERCON_POLICY_ID = 'pol_123';
    const { client, get } = fakeClient();
    expect(await resolveConfiguredPolicyId(client)).toBe('pol_123');
    expect(get).not.toHaveBeenCalled();
  });

  it('returns undefined when nothing is configured (API derives the safety-net policy)', async () => {
    const { client } = fakeClient();
    expect(await resolveConfiguredPolicyId(client)).toBeUndefined();
  });

  it('caches the resolved id across calls', async () => {
    process.env.CLEVERCON_POLICY_ID = 'pol_abc';
    const { client } = fakeClient();
    expect(await resolveConfiguredPolicyId(client)).toBe('pol_abc');
    delete process.env.CLEVERCON_POLICY_ID; // the cache must hold the earlier value
    expect(await resolveConfiguredPolicyId(client)).toBe('pol_abc');
  });

  it('matches a legacy {rules,salt} JSON bundle commitment to a pinned policyId', async () => {
    // CLEVERCON_POLICY_JSON avoids the key codec; the commitment is computed by the
    // prover, so stub the dynamic import to keep this unit test hermetic.
    process.env.CLEVERCON_POLICY_JSON = JSON.stringify({ rules: { r1: { ceiling: 5 } }, salt: 'ff' });
    vi.doMock('@clevercon/agent-sdk/prover', () => ({
      commitmentForBundle: async () => 'ABCDEF',
      DEFAULT_POSEIDON_ARTIFACTS: { p2: '', p3: '', p4: '' },
    }));
    vi.doMock('@clevercon/agent-sdk/artifacts', () => ({
      resolveArtifacts: async () => ({ wasmPath: '', zkeyPath: '' }),
    }));
    const { client } = fakeClient([
      { id: 'pol_match', commitment: 'abcdef', status: 'active' },
      { id: 'pol_other', commitment: 'deadbeef', status: 'active' },
    ]);
    expect(await resolveConfiguredPolicyId(client)).toBe('pol_match');
    vi.doUnmock('@clevercon/agent-sdk/prover');
    vi.doUnmock('@clevercon/agent-sdk/artifacts');
  });
});
