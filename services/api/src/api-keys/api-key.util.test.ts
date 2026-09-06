import { describe, it, expect } from 'vitest';
import { generateApiKey, parseApiKey } from './api-key.util';

describe('api-key.util', () => {
  it('generates a cc_-prefixed key that parses back to its parts', () => {
    const { key, prefix, secret } = generateApiKey();
    expect(key).toBe(`cc_${prefix}.${secret}`);
    const parsed = parseApiKey(key);
    expect(parsed).toEqual({ prefix, secret });
  });

  it('generates unique keys', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('nope')).toBeNull();
    expect(parseApiKey('cc_only')).toBeNull();
    expect(parseApiKey('cc_.secret')).toBeNull();
    expect(parseApiKey('cc_prefix.')).toBeNull();
    expect(parseApiKey(123)).toBeNull();
  });
});
