/**
 * Integration test for the vault + tasks data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vault: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tasks: any;

describe.skipIf(!DB)('Vault + Tasks (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { VaultService } = await import('./vault.service.js');
    const { TasksService } = await import('../tasks/tasks.service.js');
    vault = new VaultService(prisma);
    tasks = new TasksService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.task.deleteMany();
    await prisma.vaultAccount.deleteMany();
    await prisma.service.deleteMany();
    await prisma.user.deleteMany();
  });

  it('aggregates vault balances across a user wallets and nets available', async () => {
    const user = await prisma.user.create({
      data: {
        wallets: {
          create: [
            { address: 'GWALLET1', isPrimary: true },
            { address: 'GWALLET2', isPrimary: false },
          ],
        },
      },
    });
    await prisma.vaultAccount.createMany({
      data: [
        { address: 'GWALLET1', asset: 'USDC', balance: '100', locked: '30', totalDeposited: '120' },
        { address: 'GWALLET2', asset: 'USDC', balance: '50', locked: '0', totalDeposited: '50' },
        // A vault for someone else must not leak in.
        { address: 'GSTRANGER', asset: 'USDC', balance: '999', locked: '0' },
      ],
    });

    const v = await vault.getForUser(user.id);
    expect(v.balance).toBe(150);
    expect(v.locked).toBe(30);
    expect(v.available).toBe(120);
    expect(v.accounts).toHaveLength(2);
  });

  it('returns zeros for a user with no vault', async () => {
    const user = await prisma.user.create({
      data: { wallets: { create: { address: 'GEMPTY', isPrimary: true } } },
    });
    const v = await vault.getForUser(user.id);
    expect(v).toMatchObject({ balance: 0, available: 0, locked: 0 });
    expect(v.accounts).toHaveLength(0);
  });

  it('lists the user tasks with confirmed spend and step counts, scoped to the buyer', async () => {
    const buyer = await prisma.user.create({ data: {} });
    const other = await prisma.user.create({ data: {} });

    const task = await prisma.task.create({
      data: {
        buyerId: buyer.id,
        title: 'Compose job',
        mode: 'COMPOSE',
        budget: '2.5',
        asset: 'USDC',
        status: 'RUNNING',
        steps: {
          create: [
            { index: 0, action: 'a', estimatedCost: '0.5', status: 'RELEASED' },
            { index: 1, action: 'b', estimatedCost: '0.5', status: 'PENDING' },
          ],
        },
      },
    });
    await prisma.payment.createMany({
      data: [
        {
          taskId: task.id,
          fromAddress: 'GA',
          toAddress: 'GB',
          asset: 'USDC',
          amount: '0.5',
          method: 'X402',
          status: 'CONFIRMED',
          idempotencyKey: 'k1',
        },
        // A pending payment must not count toward spend.
        {
          taskId: task.id,
          fromAddress: 'GA',
          toAddress: 'GB',
          asset: 'USDC',
          amount: '0.5',
          method: 'X402',
          status: 'PENDING',
          idempotencyKey: 'k2',
        },
      ],
    });
    await prisma.task.create({
      data: { buyerId: other.id, title: 'not mine', mode: 'DIRECT', budget: '1', asset: 'USDC' },
    });

    const res = await tasks.listForUser(buyer.id, {});
    expect(res.total).toBe(1);
    expect(res.items[0].title).toBe('Compose job');
    expect(res.items[0].spent).toBe(0.5);
    expect(res.items[0].stepCount).toBe(2);
    expect(res.items[0].completedSteps).toBe(1);

    const one = await tasks.getForUser(buyer.id, task.id);
    expect(one.id).toBe(task.id);
    await expect(tasks.getForUser(other.id, task.id)).rejects.toThrow();
  });

  it('creates a DIRECT task with a seeded step and rejects a bad direct hire', async () => {
    const buyer = await prisma.user.create({ data: {} });
    const service = await prisma.service.create({
      data: {
        agentId: 'svc-a',
        name: 'Svc A',
        description: 'x',
        capabilities: ['x'],
        pricingModel: 'X402',
        pricePerCall: '0.05',
        endpoint: 'http://localhost',
        stellarAddress: 'GSVC',
        status: 'ACTIVE',
      },
    });

    const created = await tasks.create(buyer.id, {
      title: 'Pay Svc A',
      mode: 'DIRECT',
      budget: 1,
      serviceId: service.id,
    });
    expect(created.status).toBe('DRAFT');
    expect(created.stepCount).toBe(1);
    expect(created.spent).toBe(0);

    // DIRECT with no service, and with an unknown service, must be rejected.
    await expect(
      tasks.create(buyer.id, { title: 'x', mode: 'DIRECT', budget: 1 }),
    ).rejects.toThrow();
    await expect(
      tasks.create(buyer.id, { title: 'x', mode: 'DIRECT', budget: 1, serviceId: 'nope' }),
    ).rejects.toThrow();

    // COMPOSE needs no service and seeds no steps.
    const compose = await tasks.create(buyer.id, { title: 'Big job', mode: 'COMPOSE', budget: 5 });
    expect(compose.stepCount).toBe(0);

    const list = await tasks.listForUser(buyer.id, {});
    expect(list.total).toBe(2);
  });
});
