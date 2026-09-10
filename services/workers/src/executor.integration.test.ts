/**
 * Integration test for executeTask's reputation + health side effects against
 * live Postgres. Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

let prisma: any;
let executeTask: any;

async function seedTaskWithStep(endpoint: string) {
  const buyer = await prisma.user.create({ data: {} });
  const service = await prisma.service.create({
    data: {
      agentId: 'svc-' + Math.random().toString(36).slice(2, 8),
      name: 'Svc',
      description: 'd',
      pricingModel: 'X402',
      pricePerCall: '0.05',
      endpoint,
      stellarAddress: 'GADDR' + Math.random().toString(36).slice(2, 8),
      status: 'ACTIVE',
      reputation: { create: {} },
    },
  });
  const task = await prisma.task.create({
    data: {
      buyerId: buyer.id,
      title: 'job',
      mode: 'DIRECT',
      budget: '1',
      asset: 'USDC',
      steps: {
        create: { index: 0, serviceId: service.id, action: 'do', estimatedCost: '0.05' },
      },
    },
  });
  return { taskId: task.id, serviceId: service.id };
}

const okFetch = (async () => new Response('result', { status: 200 })) as typeof fetch;
const failFetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;

describe.skipIf(!DB)('executeTask reputation + health (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    ({ executeTask } = await import('./executor.js'));
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
    await prisma.user.deleteMany();
  });

  it('records a successful job: reputation + latency + lastSeen', async () => {
    const { taskId, serviceId } = await seedTaskWithStep('https://svc.test');
    const result = await executeTask(prisma, okFetch, taskId);
    expect(result.status).toBe('completed');

    const rep = await prisma.serviceReputation.findUnique({ where: { serviceId } });
    expect(rep.totalJobs).toBe(1);
    expect(rep.successfulJobs).toBe(1);
    expect(rep.failedJobs).toBe(0);
    expect(rep.score).toBe(5); // 100% success -> 5/5
    expect(rep.avgLatencyMs).toBeGreaterThanOrEqual(0);

    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    expect(svc.lastSeen).not.toBeNull();
  });

  it('records a failed job: failedJobs up, score down, no lastSeen bump', async () => {
    const { taskId, serviceId } = await seedTaskWithStep('https://svc.test');
    const result = await executeTask(prisma, failFetch, taskId);
    expect(result.status).toBe('failed');

    const rep = await prisma.serviceReputation.findUnique({ where: { serviceId } });
    expect(rep.totalJobs).toBe(1);
    expect(rep.successfulJobs).toBe(0);
    expect(rep.failedJobs).toBe(1);
    expect(rep.score).toBe(0); // 0% success

    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    expect(svc.lastSeen).toBeNull();
  });

  it('is idempotent: replaying a completed task does not double-count reputation', async () => {
    const { taskId, serviceId } = await seedTaskWithStep('https://svc.test');
    await executeTask(prisma, okFetch, taskId);
    await executeTask(prisma, okFetch, taskId); // terminal -> no-op

    const rep = await prisma.serviceReputation.findUnique({ where: { serviceId } });
    expect(rep.totalJobs).toBe(1);
  });
});
