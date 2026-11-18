import { describe, it, expect } from 'vitest';
import {
  resolveNetwork,
  assertNetworkConsistent,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  USDC_ISSUER_MAINNET,
  USDC_ISSUER_TESTNET,
} from './constants.js';

describe('resolveNetwork', () => {
  it('resolves mainnet values for mainnet/public', () => {
    for (const n of ['mainnet', 'public']) {
      const c = resolveNetwork(n);
      expect(c.isMainnet).toBe(true);
      expect(c.passphrase).toBe(MAINNET_PASSPHRASE);
      expect(c.usdcIssuer).toBe(USDC_ISSUER_MAINNET);
      expect(c.horizonUrl).toContain('horizon.stellar.org');
      expect(c.horizonUrl).not.toContain('testnet');
    }
  });

  it('resolves testnet values for testnet/undefined/anything else', () => {
    for (const n of ['testnet', undefined, 'local', 'foo']) {
      const c = resolveNetwork(n);
      expect(c.isMainnet).toBe(false);
      expect(c.passphrase).toBe(TESTNET_PASSPHRASE);
      expect(c.usdcIssuer).toBe(USDC_ISSUER_TESTNET);
    }
  });
});

describe('assertNetworkConsistent', () => {
  it('passes on testnet regardless of values', () => {
    expect(() =>
      assertNetworkConsistent('testnet', { passphrase: TESTNET_PASSPHRASE }),
    ).not.toThrow();
  });

  it('throws when mainnet still has the testnet passphrase', () => {
    expect(() =>
      assertNetworkConsistent('mainnet', {
        passphrase: TESTNET_PASSPHRASE,
        rpcUrl: 'https://rpc.example.com',
      }),
    ).toThrow(/mainnet/i);
  });

  it('throws when the mainnet RPC is missing', () => {
    expect(() => assertNetworkConsistent('mainnet', { passphrase: MAINNET_PASSPHRASE })).toThrow(
      /STELLAR_RPC_URL/,
    );
  });

  it('throws when the mainnet RPC points at testnet', () => {
    expect(() =>
      assertNetworkConsistent('mainnet', {
        passphrase: MAINNET_PASSPHRASE,
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    ).toThrow(/testnet/i);
  });

  it('passes when mainnet is fully configured', () => {
    expect(() =>
      assertNetworkConsistent('mainnet', {
        passphrase: MAINNET_PASSPHRASE,
        rpcUrl: 'https://mainnet.rpc.example.com',
        usdcIssuer: USDC_ISSUER_MAINNET,
      }),
    ).not.toThrow();
  });
});
