import { describe, it, expect } from 'vitest';
import { requireEnv, EnvValidationError } from './env.js';

// A valid 56-char Stellar secret key (S + 55 base32 chars A-Z2-7) used throughout tests.
const VALID_SECRET = 'SCJ4HXIMNDYRBCXE2QHKXCNHMFZKIOZBHGP4M2U7ZUPHD35OSEKTZKXV';
// A valid 56-char Stellar contract ID (C + 55 base32 chars).
const VALID_CONTRACT = 'CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE';

describe('requireEnv', () => {
  // ── Missing required key ────────────────────────────────────────────────────

  it('throws EnvValidationError naming the key when a single required key is missing', () => {
    const source = {};
    expect(() => requireEnv({ MY_VAR: {} }, source)).toThrow(EnvValidationError);
    expect(() => requireEnv({ MY_VAR: {} }, source)).toThrow('MY_VAR');
  });

  // ── Valid shapes return trimmed values ──────────────────────────────────────

  it('accepts a present string value and returns the trimmed result', () => {
    const source = { MY_STRING: '  hello world  ' };
    const result = requireEnv({ MY_STRING: { type: 'string' } }, source);
    expect(result.MY_STRING).toBe('hello world');
  });

  it('accepts a valid URL and returns the trimmed value', () => {
    const source = { MY_URL: '  https://example.com  ' };
    const result = requireEnv({ MY_URL: { type: 'url' } }, source);
    expect(result.MY_URL).toBe('https://example.com');
  });

  it('accepts a valid number string and returns the trimmed value', () => {
    const source = { MY_NUM: '  42  ' };
    const result = requireEnv({ MY_NUM: { type: 'number' } }, source);
    expect(result.MY_NUM).toBe('42');
  });

  it('accepts a valid Stellar secret key', () => {
    const source = { MY_SECRET: `  ${VALID_SECRET}  ` };
    const result = requireEnv({ MY_SECRET: { type: 'stellarSecret' } }, source);
    expect(result.MY_SECRET).toBe(VALID_SECRET);
  });

  it('accepts a valid Stellar contract ID', () => {
    const source = { MY_CONTRACT: `  ${VALID_CONTRACT}  ` };
    const result = requireEnv({ MY_CONTRACT: { type: 'stellarContract' } }, source);
    expect(result.MY_CONTRACT).toBe(VALID_CONTRACT);
  });

  // ── Whitespace-only treated as missing ──────────────────────────────────────

  it('treats a whitespace-only value as missing and throws', () => {
    const source = { MY_VAR: '   ' };
    const err = (() => {
      try {
        requireEnv({ MY_VAR: { type: 'string' } }, source);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(EnvValidationError);
    expect((err as EnvValidationError).issues[0]).toMatch(/MY_VAR/);
  });

  // ── All issues collected in one throw ───────────────────────────────────────

  it('collects all three missing keys into a single error with three issues', () => {
    const source = {};
    let thrown: unknown;
    try {
      requireEnv({ A: {}, B: {}, C: {} }, source);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    const err = thrown as EnvValidationError;
    expect(err.issues).toHaveLength(3);
    expect(err.issues.some((i) => i.includes('A'))).toBe(true);
    expect(err.issues.some((i) => i.includes('B'))).toBe(true);
    expect(err.issues.some((i) => i.includes('C'))).toBe(true);
  });

  // ── Optional keys ───────────────────────────────────────────────────────────

  it('does not throw when an optional key is missing', () => {
    const source = {};
    expect(() => requireEnv({ MY_OPT: { optional: true } }, source)).not.toThrow();
  });

  // ── LLM_PROVIDER=mock exception pattern ────────────────────────────────────

  it('passes validation when ANTHROPIC_API_KEY is optional because LLM_PROVIDER=mock', () => {
    const source = { LLM_PROVIDER: 'mock' };
    // Simulate the spec built at startup: optional iff LLM_PROVIDER === 'mock'
    const spec = {
      ANTHROPIC_API_KEY: { optional: source.LLM_PROVIDER === 'mock' },
    };
    expect(() => requireEnv(spec, source)).not.toThrow();
  });

  it('fails validation when LLM_PROVIDER is not mock and ANTHROPIC_API_KEY is absent', () => {
    const source = { LLM_PROVIDER: 'anthropic' };
    const spec = {
      ANTHROPIC_API_KEY: { optional: source.LLM_PROVIDER === 'mock' },
    };
    expect(() => requireEnv(spec, source)).toThrow(EnvValidationError);
    expect(() => requireEnv(spec, source)).toThrow('ANTHROPIC_API_KEY');
  });

  it('fails validation when LLM_PROVIDER is unset and ANTHROPIC_API_KEY is absent', () => {
    const source = {};
    const spec = {
      ANTHROPIC_API_KEY: { optional: source['LLM_PROVIDER' as keyof typeof source] === 'mock' },
    };
    expect(() => requireEnv(spec, source)).toThrow(EnvValidationError);
  });

  // ── Invalid shape values ────────────────────────────────────────────────────

  it('throws naming the key when a URL value is malformed', () => {
    const source = { MY_URL: 'not-a-url' };
    let thrown: unknown;
    try {
      requireEnv({ MY_URL: { type: 'url' } }, source);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as EnvValidationError).issues[0]).toMatch(/MY_URL/);
  });

  it('throws naming the key when a number value is non-numeric', () => {
    const source = { MY_NUM: 'abc' };
    let thrown: unknown;
    try {
      requireEnv({ MY_NUM: { type: 'number' } }, source);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as EnvValidationError).issues[0]).toMatch(/MY_NUM/);
  });

  it('throws naming the key when a stellarSecret value is malformed', () => {
    const source = { MY_SECRET: 'not-a-stellar-secret' };
    let thrown: unknown;
    try {
      requireEnv({ MY_SECRET: { type: 'stellarSecret' } }, source);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as EnvValidationError).issues[0]).toMatch(/MY_SECRET/);
  });

  it('throws naming the key when a stellarContract value is malformed', () => {
    const source = { MY_CONTRACT: 'not-a-stellar-contract' };
    let thrown: unknown;
    try {
      requireEnv({ MY_CONTRACT: { type: 'stellarContract' } }, source);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as EnvValidationError).issues[0]).toMatch(/MY_CONTRACT/);
  });
});
