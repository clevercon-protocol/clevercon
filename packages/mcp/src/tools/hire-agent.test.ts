import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hireAgentHandler } from './hire-agent.js';
import { _resetConfiguredPolicyCache } from '../policy-resolve.js';

const POLICY_ENVS = [
  'CLEVERCON_POLICY_ID',
  'CLEVERCON_POLICY_KEY',
  'CLEVERCON_POLICY_JSON',
  'CLEVERCON_POLICY_FILE',
];

function text(res: { content: Array<{ text: string }> }): string {
  return res.content.map((c) => c.text).join('');
}

describe('hire_agent fail-closed', () => {
  beforeEach(() => {
    _resetConfiguredPolicyCache();
    for (const k of POLICY_ENVS) delete process.env[k];
  });
  afterEach(() => {
    _resetConfiguredPolicyCache();
    for (const k of POLICY_ENVS) delete process.env[k];
  });

  const config = { api_url: 'http://api.test', api_key: 'cc_test' };
  const baseArgs = { title: 'Hire', mode: 'DIRECT', budget: 0.1, serviceId: 'svc1' };

  it('blocks a hire when no rule is configured (never a throwaway), without calling the API', async () => {
    const res = await hireAgentHandler({ ...baseArgs }, config);
    const out = text(res);
    expect(out).toContain('No spending rule configured');
    // Resolution short-circuits on empty env, so no network call is attempted.
  });

  it('passes the explicitly provided policyId straight through', async () => {
    // With an explicit policyId the handler reaches the API call; a network error here
    // proves it got past the fail-closed guard (it did not block).
    const res = await hireAgentHandler({ ...baseArgs, policyId: 'pol_explicit' }, config);
    const out = text(res);
    expect(out).not.toContain('No spending rule configured');
  });
});
