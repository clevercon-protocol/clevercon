/**
 * Integration test for the indexer's persistence against a live Postgres.
 * Runs only when TEST_DATABASE_URL is set (see auth.integration.test.ts recipe).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NormalizedEvent } from './events.js';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let indexer: any;

function ev(cursor: string, type = 'deposit'): NormalizedEvent {
  return {
    contractId: 'CVAULT',
    type,
    ledger: 1n,
    txHash: 'tx' + cursor,
    cursor,
    payload: { topics: [], data: 'x' },
  };
}

describe.skipIf(!DB)('Indexer (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { Indexer } = await import('./indexer.js');
    indexer = new Indexer(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.chainEvent.deleteMany();
    await prisma.indexerState.deleteMany();
    await prisma.vaultAccount.deleteMany();
  });

  function vaultEv(cursor: string, type: string, amount: string): NormalizedEvent {
    return {
      contractId: 'CVAULT',
      type,
      ledger: 1n,
      txHash: 'tx' + cursor,
      cursor,
      payload: { topics: ['GUSER', 'CASSET'], data: { amount } },
    };
  }

  it('persists events and dedupes on cursor', async () => {
    expect(await indexer.persistEvents([ev('c1'), ev('c2')])).toBe(2);
    // c2 already present -> only c3 inserted
    expect(await indexer.persistEvents([ev('c2'), ev('c3')])).toBe(1);
    expect(await prisma.chainEvent.count()).toBe(3);
  });

  it('no-ops on empty input', async () => {
    expect(await indexer.persistEvents([])).toBe(0);
  });

  it('projects deposit/withdraw events (stroops -> USDC) into the vault_accounts mirror', async () => {
    await indexer.persistEvents([
      vaultEv('d1', 'deposit_event', '50000000'), // +5.0 USDC (50,000,000 stroops)
      vaultEv('w1', 'withdraw_event', '20000000'), // -2.0 USDC
    ]);
    const row = await prisma.vaultAccount.findUnique({
      where: { address_asset: { address: 'GUSER', asset: 'CASSET' } },
    });
    expect(Number(row.balance)).toBe(3); // net 3.0 USDC, not 30000000 stroops
    expect(Number(row.totalDeposited)).toBe(5);

    // Replaying the same events must not double-count (exactly-once projection).
    await indexer.persistEvents([
      vaultEv('d1', 'deposit_event', '50000000'),
      vaultEv('w1', 'withdraw_event', '20000000'),
    ]);
    const again = await prisma.vaultAccount.findUnique({
      where: { address_asset: { address: 'GUSER', asset: 'CASSET' } },
    });
    expect(Number(again.balance)).toBe(3);
  });

  it('round-trips the resume cursor', async () => {
    expect(await indexer.getCursor('vault')).toBeNull();
    await indexer.setCursor('vault', 'abc');
    expect(await indexer.getCursor('vault')).toBe('abc');
    await indexer.setCursor('vault', 'def');
    expect(await indexer.getCursor('vault')).toBe('def');
  });
});
