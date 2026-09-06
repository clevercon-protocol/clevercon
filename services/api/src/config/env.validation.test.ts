import { describe, it, expect } from 'vitest';
import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'secret' };

describe('validateEnv', () => {
  it('accepts a valid config and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(4100);
    expect(env.NETWORK).toBe('testnet');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws a descriptive error on missing required vars', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('coerces API_PORT and validates the NETWORK enum', () => {
    const env = validateEnv({ ...base, API_PORT: '5000', NETWORK: 'local' });
    expect(env.API_PORT).toBe(5000);
    expect(env.NETWORK).toBe('local');
  });

  it('rejects an invalid NETWORK value', () => {
    expect(() => validateEnv({ ...base, NETWORK: 'devnet' })).toThrow();
  });
});
