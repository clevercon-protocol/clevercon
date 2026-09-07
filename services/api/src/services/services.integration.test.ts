/**
 * Integration test for the marketplace + /me data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let services: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let users: any;

async function seedService(agentId: string, category: string, price: string) {
  await prisma.service.create({
    data: {
      agentId,
      name: agentId,
      description: 'test',
      category,
      capabilities: ['x'],
      pricingModel: 'X402',
      pricePerCall: price,
      endpoint: 'http://localhost',
      stellarAddress: 'G' + agentId.padEnd(55, 'A').slice(0, 55),
      status: 'ACTIVE',
      reputation: { create: { score: 4.5, totalJobs: 3 } },
    },
  });
}

describe.skipIf(!DB)('Services + Users (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { ServicesService } = await import('./services.service.js');
    const { UsersService } = await import('../users/users.service.js');
    services = new ServicesService(prisma);
    users = new UsersService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    // FK-safe reset: clear dependents before the rows they reference.
    await prisma.payment.deleteMany();
    await prisma.task.deleteMany();
    await prisma.vaultAccount.deleteMany();
    await prisma.service.deleteMany();
    await prisma.user.deleteMany();
  });

  it('lists active services with reputation and paginates', async () => {
    await seedService('a', 'Data & Oracles', '0.05');
    await seedService('b', 'AI & Analysis', '0.10');
    const all = await services.list({});
    expect(all.total).toBe(2);
    expect(all.items[0].reputation.score).toBe(4.5);
    expect(typeof all.items[0].pricePerCall).toBe('number');

    const paged = await services.list({ limit: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
  });

  it('filters by category', async () => {
    await seedService('a', 'Data & Oracles', '0.05');
    await seedService('b', 'AI & Analysis', '0.10');
    const filtered = await services.list({ category: 'AI & Analysis' });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].agentId).toBe('b');
  });

  it('gets a service by id and 404s on unknown', async () => {
    await seedService('a', 'Data & Oracles', '0.05');
    const list = await services.list({});
    const one = await services.get(list.items[0].id);
    expect(one.agentId).toBe('a');
    await expect(services.get('nope')).rejects.toThrow();
  });

  it('getMe returns the user roles and wallets', async () => {
    const user = await prisma.user.create({
      data: {
        wallets: { create: { address: 'GTESTWALLET', isPrimary: true } },
        roles: { create: [{ role: 'BUYER' }] },
      },
    });
    const me = await users.getMe(user.id);
    expect(me.roles).toEqual(['BUYER']);
    expect(me.wallets[0].address).toBe('GTESTWALLET');
    await expect(users.getMe('nope')).rejects.toThrow();
  });
});
