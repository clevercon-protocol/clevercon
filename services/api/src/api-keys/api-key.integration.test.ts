/**
 * Integration test for API keys against a live Postgres. Runs only when
 * TEST_DATABASE_URL is set (see auth.integration.test.ts for the local recipe).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any;
let userId: string;

describe.skipIf(!DB)('ApiKeyService (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { ApiKeyService } = await import('./api-key.service.js');
    service = new ApiKeyService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany(); // cascades api_keys
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
  });

  it('creates a key, returns the secret once, and verifies it', async () => {
    const created = await service.create(userId, 'ci-key', ['read']);
    expect(created.key).toMatch(/^cc_.+\..+/);

    const identity = await service.verify(created.key);
    expect(identity).not.toBeNull();
    expect(identity.userId).toBe(userId);
    expect(identity.scopes).toEqual(['read']);

    // lastUsedAt is bumped on verify
    const row = await prisma.apiKey.findUnique({ where: { id: created.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it('rejects a wrong secret and a malformed key', async () => {
    const created = await service.create(userId, 'ci-key');
    const tampered = created.key.slice(0, -3) + 'xyz';
    expect(await service.verify(tampered)).toBeNull();
    expect(await service.verify('cc_bogus.secret')).toBeNull();
    expect(await service.verify('garbage')).toBeNull();
  });

  it('rejects a revoked key', async () => {
    const created = await service.create(userId, 'ci-key');
    await service.revoke(userId, created.id);
    expect(await service.verify(created.key)).toBeNull();
  });

  it('lists keys without exposing secrets', async () => {
    await service.create(userId, 'k1');
    await service.create(userId, 'k2');
    const list = await service.list(userId);
    expect(list).toHaveLength(2);
    for (const k of list) {
      expect(k).not.toHaveProperty('keyHash');
      expect(k).toHaveProperty('prefix');
    }
  });
});
