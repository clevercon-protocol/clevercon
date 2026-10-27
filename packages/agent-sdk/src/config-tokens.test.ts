import { describe, it, expect } from 'vitest';
import {
  packPolicyKey,
  unpackPolicyKey,
  packRuleKey,
  unpackRuleKey,
  packSessionKey,
  unpackSessionKey,
  POLICY_KEY_PREFIX,
  RULE_KEY_PREFIX,
  SESSION_KEY_PREFIX,
} from './config-tokens.js';

const rid = 'a'.repeat(64);

describe('config tokens', () => {
  it('policy key round-trips { rules, salt } and is opaque', () => {
    const bundle = { rules: { perPaymentCeilingUsdc: 100, allowlist: [{ payeeAddress: 'G1' }] }, salt: 'deadbeef' };
    const token = packPolicyKey(bundle);
    expect(token.startsWith(POLICY_KEY_PREFIX)).toBe(true);
    expect(token).not.toContain('deadbeef'); // the salt is not readable in the token
    expect(unpackPolicyKey(token)).toEqual(bundle);
  });

  it('policy key accepts a legacy raw { rules, salt } JSON', () => {
    const bundle = { rules: { perPaymentCeilingUsdc: 5 }, salt: 'abc' };
    expect(unpackPolicyKey(JSON.stringify(bundle))).toEqual(bundle);
  });

  it('policy key rejects malformed input', () => {
    expect(() => unpackPolicyKey('not-a-token')).toThrow();
    expect(() => unpackPolicyKey(`${POLICY_KEY_PREFIX}@@@`)).toThrow();
  });

  it('rule key round-trips a rule id and accepts a bare id', () => {
    const token = packRuleKey(rid);
    expect(token.startsWith(RULE_KEY_PREFIX)).toBe(true);
    expect(unpackRuleKey(token)).toBe(rid);
    expect(unpackRuleKey(rid)).toBe(rid);
  });

  it('rule key rejects a non-hex id', () => {
    expect(() => packRuleKey('xyz')).toThrow();
    expect(() => unpackRuleKey('nope')).toThrow();
  });

  it('session key round-trips secret + network + rule', () => {
    const cfg = { sessionSecret: 'SABC', vaultId: 'CVAULT', usdcSac: 'CUSDC', rpcUrl: 'https://rpc', ruleId: rid };
    const token = packSessionKey(cfg);
    expect(token.startsWith(SESSION_KEY_PREFIX)).toBe(true);
    expect(unpackSessionKey(token)).toEqual(cfg);
  });

  it('session key omits optional rpc/rule cleanly', () => {
    const token = packSessionKey({ sessionSecret: 'S', vaultId: 'V', usdcSac: 'U' });
    const out = unpackSessionKey(token);
    expect(out.sessionSecret).toBe('S');
    expect(out.rpcUrl).toBeUndefined();
    expect(out.ruleId).toBeUndefined();
  });
});
