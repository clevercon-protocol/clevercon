import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { createAgentWallet } from './agent-wallet.js';

function mockFetch(status = 200, body: unknown = { id: 't1' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const KEY = 'cc_test.secret';

describe('createAgentWallet', () => {
  it('requires a secretKey and rejects a malformed one', () => {
    expect(() => createAgentWallet({ apiKey: KEY, secretKey: '' })).toThrow(
      /secretKey is required/,
    );
    expect(() => createAgentWallet({ apiKey: KEY, secretKey: 'not-a-secret' })).toThrow();
  });

  it('derives the agent address from its own secret', () => {
    const kp = Keypair.random();
    const wallet = createAgentWallet({ apiKey: KEY, secretKey: kp.secret() });
    expect(wallet.address).toBe(kp.publicKey());
    expect(typeof wallet.fetch).toBe('function');
  });

  it('topUp without vault config throws (needs a session to pull on the public lane)', async () => {
    const kp = Keypair.random();
    const { fetchImpl, calls } = mockFetch();
    const wallet = createAgentWallet({
      apiKey: KEY,
      secretKey: kp.secret(),
      apiUrl: 'http://x',
      fetchImpl,
    });
    await expect(wallet.topUp(5)).rejects.toThrow(/vault config/i);
    expect(calls).toHaveLength(0);
  });

  it('getBudget reads the vault position through the spender', async () => {
    const kp = Keypair.random();
    const { fetchImpl, calls } = mockFetch(200, { balance: 10, available: 7, locked: 3 });
    const wallet = createAgentWallet({
      apiKey: KEY,
      secretKey: kp.secret(),
      apiUrl: 'http://x',
      fetchImpl,
    });
    const budget = await wallet.getBudget();
    expect(budget.available).toBe(7);
    expect(calls[0].url).toBe('http://x/vault');
    expect(calls[0].init.method).toBe('GET');
  });
});
