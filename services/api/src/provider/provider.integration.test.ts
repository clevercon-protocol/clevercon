/**
 * Integration test for the provider data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let provider: any;

async function seedService(providerId: string, agentId: string, address: string, score: number) {
  await prisma.service.create({
    data: {
      providerId,
      agentId,
      name: agentId,
      description: 'test',
      category: 'Data & Oracles',
      capabilities: ['x'],
      pricingModel: 'X402',
      pricePerCall: '0.05',
      endpoint: 'http://localhost',
      stellarAddress: address,
      status: 'ACTIVE',
      reputation: { create: { score, totalJobs: 5 } },
    },
  });
}

describe.skipIf(!DB)('Provider (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { ProviderService } = await import('./provider.service.js');
    provider = new ProviderService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.task.deleteMany();
    await prisma.service.deleteMany();
    await prisma.user.deleteMany();
  });

  it('lists only the provider own services', async () => {
    const me = await prisma.user.create({ data: {} });
    const other = await prisma.user.create({ data: {} });
    await seedService(me.id, 'mine', 'GMINE', 4.8);
    await seedService(other.id, 'theirs', 'GTHEIRS', 4.1);

    const res = await provider.listServices(me.id);
    expect(res.total).toBe(1);
    expect(res.items[0].agentId).toBe('mine');
    expect(res.items[0].reputation.score).toBe(4.8);
  });

  it('sums confirmed earnings to the provider addresses and lists recent jobs', async () => {
    const me = await prisma.user.create({ data: {} });
    await seedService(me.id, 'mine', 'GMINE', 4.6);

    const pay = (amount: string, status: string, key: string) =>
      prisma.payment.create({
        data: {
          fromAddress: 'GBUYER',
          toAddress: 'GMINE',
          asset: 'USDC',
          amount,
          method: 'X402',
          status,
          idempotencyKey: key,
        },
      });
    await pay('0.05', 'CONFIRMED', 'p1');
    await pay('0.10', 'CONFIRMED', 'p2');
    await pay('0.99', 'PENDING', 'p3'); // must not count
    // A payment to an address that is not the provider's must not count.
    await prisma.payment.create({
      data: {
        fromAddress: 'GBUYER',
        toAddress: 'GSOMEONEELSE',
        asset: 'USDC',
        amount: '5',
        method: 'X402',
        status: 'CONFIRMED',
        idempotencyKey: 'p4',
      },
    });

    const e = await provider.earnings(me.id);
    expect(e.totalEarned).toBeCloseTo(0.15, 7);
    expect(e.jobs).toBe(2);
    expect(e.rating).toBe(4.6);
    expect(e.recent.length).toBe(3); // the 3 payments to GMINE, newest first
    expect(e.recent[0].service).toBe('mine');
  });

  it('returns zeros for a provider with no services', async () => {
    const me = await prisma.user.create({ data: {} });
    const e = await provider.earnings(me.id);
    expect(e).toMatchObject({ totalEarned: 0, thisWeek: 0, jobs: 0, rating: 0 });
    expect(e.recent).toHaveLength(0);
  });
});
