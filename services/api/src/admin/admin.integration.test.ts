/**
 * Integration test for the admin data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

let prisma: any;
let admin: any;

const mockConfig = { get: () => '' } as unknown as ConstructorParameters<
  typeof import('./admin.service.js').AdminService
>[1];

describe.skipIf(!DB)('Admin (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { AdminService } = await import('./admin.service.js');
    admin = new AdminService(prisma, mockConfig);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.taskStep.deleteMany();
    await prisma.task.deleteMany();
    await prisma.serviceReputation.deleteMany();
    await prisma.service.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
  });

  it('reports real platform stats', async () => {
    const u1 = await prisma.user.create({ data: {} });
    await prisma.user.create({ data: {} });
    await prisma.service.create({
      data: {
        providerId: u1.id,
        agentId: 'svc-a',
        name: 'A',
        description: 'd',
        pricingModel: 'X402',
        pricePerCall: '0.05',
        endpoint: 'http://a',
        stellarAddress: 'GA',
        status: 'ACTIVE',
      },
    });
    await prisma.payment.create({
      data: {
        fromAddress: 'GB',
        toAddress: 'GA',
        asset: 'USDC',
        amount: '1.50',
        method: 'VAULT_RELEASE',
        status: 'CONFIRMED',
        idempotencyKey: 'k1',
      },
    });

    const s = await admin.stats();
    expect(s.users).toBe(2);
    expect(s.activeServices).toBe(1);
    expect(s.paymentsCount).toBe(1);
    expect(s.paymentsVolumeUsdc).toBeCloseTo(1.5, 7);
  });

  it('lists users with their roles', async () => {
    const u = await prisma.user.create({
      data: { roles: { create: [{ role: 'BUYER' }] } },
    });
    const res = await admin.listUsers();
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe(u.id);
    expect(res.items[0].roles).toEqual(['BUYER']);
  });

  it('grants and revokes roles, and refuses to remove the last admin', async () => {
    const u = await prisma.user.create({ data: {} });
    const granted = await admin.setUserRole(u.id, 'PROVIDER', true);
    expect(granted.roles).toContain('PROVIDER');
    // idempotent
    await admin.setUserRole(u.id, 'PROVIDER', true);

    const revoked = await admin.setUserRole(u.id, 'PROVIDER', false);
    expect(revoked.roles).not.toContain('PROVIDER');

    // Last-admin protection.
    const adminUser = await prisma.user.create({
      data: { roles: { create: [{ role: 'ADMIN' }] } },
    });
    await expect(admin.setUserRole(adminUser.id, 'ADMIN', false)).rejects.toThrow();
  });
});
