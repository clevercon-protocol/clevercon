/**
 * Integration test for the webhooks data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

let prisma: any;
let webhooks: any;

describe.skipIf(!DB)('Webhooks (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { WebhooksService } = await import('./webhooks.service.js');
    webhooks = new WebhooksService(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    await prisma.webhook.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates (secret once), lists without secret, and deletes owner-scoped', async () => {
    const me = await prisma.user.create({ data: {} });
    const other = await prisma.user.create({ data: {} });

    const created = await webhooks.create(me.id, 'https://app.example.com/hook', [
      'task.completed',
    ]);
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.url).toBe('https://app.example.com/hook');

    const list = await webhooks.list(me.id);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty('secret');

    // Another user cannot delete it.
    await expect(webhooks.remove(other.id, created.id)).rejects.toThrow();
    // Owner can.
    await webhooks.remove(me.id, created.id);
    expect((await webhooks.list(me.id)).items).toHaveLength(0);
  });
});
