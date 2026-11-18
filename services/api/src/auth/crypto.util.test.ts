import { describe, it, expect } from 'vitest';
import { randomToken, generateNonce, sha256, safeEqualHex } from './crypto.util';

describe('crypto.util', () => {
  it('randomToken is url-safe and unique', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('generateNonce is unique', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it('sha256 is deterministic and hex', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('world'));
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeEqualHex compares equal/unequal digests', () => {
    const h = sha256('secret');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, sha256('other'))).toBe(false);
    expect(safeEqualHex(h, 'ab')).toBe(false);
  });
});
