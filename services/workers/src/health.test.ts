import { describe, it, expect, vi } from 'vitest';
import { sweepHealth, healthUrl } from './health.js';

interface Svc {
  id: string;
  endpoint: string;
  healthCheck: string | null;
  healthFailures: number;
  healthy?: boolean;
  lastHealthyAt?: Date | null;
}

function mockPrisma(services: Svc[]) {
  return {
    service: {
      findMany: vi.fn(async () => services),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Svc> }) => {
        const s = services.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const okFetch = vi.fn(async () => new Response('ok', { status: 200 }));
const downFetch = vi.fn(async () => new Response('err', { status: 503 }));

describe('healthUrl', () => {
  it('uses the declared healthCheck, else derives /health from the endpoint', () => {
    expect(healthUrl('https://svc.test/query', 'https://svc.test/alive')).toBe('https://svc.test/alive');
    expect(healthUrl('https://svc.test/query', null)).toBe('https://svc.test/health');
    expect(healthUrl('https://svc.test/query', '   ')).toBe('https://svc.test/health');
  });
});

describe('sweepHealth', () => {
  it('marks a reachable service healthy and resets its failure counter', async () => {
    const svc: Svc = { id: 's1', endpoint: 'https://svc.test', healthCheck: null, healthFailures: 2 };
    const res = await sweepHealth(mockPrisma([svc]), okFetch as unknown as typeof fetch);
    expect(res).toMatchObject({ checked: 1, healthy: 1, unhealthy: 0 });
    expect(svc.healthy).toBe(true);
    expect(svc.healthFailures).toBe(0);
    expect(svc.lastHealthyAt).toBeInstanceOf(Date);
  });

  it('does not mark unhealthy on a single failure (tolerates a blip)', async () => {
    const svc: Svc = {
      id: 's1',
      endpoint: 'https://svc.test',
      healthCheck: null,
      healthFailures: 0,
      healthy: true,
    };
    await sweepHealth(mockPrisma([svc]), downFetch as unknown as typeof fetch);
    expect(svc.healthFailures).toBe(1);
    expect(svc.healthy).toBe(true); // still listable after one blip
  });

  it('marks unhealthy once failures cross the threshold', async () => {
    const svc: Svc = {
      id: 's1',
      endpoint: 'https://svc.test',
      healthCheck: null,
      healthFailures: 2,
      healthy: true,
    };
    const res = await sweepHealth(mockPrisma([svc]), downFetch as unknown as typeof fetch);
    expect(res.unhealthy).toBe(1);
    expect(svc.healthFailures).toBe(3);
    expect(svc.healthy).toBe(false); // 3rd consecutive failure removes it from the directory
  });

  it('treats a reachable host with no /health route (404) as healthy', async () => {
    const svc: Svc = { id: 's1', endpoint: 'https://svc.test', healthCheck: null, healthFailures: 2 };
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    const res = await sweepHealth(mockPrisma([svc]), notFound as unknown as typeof fetch);
    expect(res.healthy).toBe(1);
    expect(svc.healthy).toBe(true); // host is up; a missing /health route must not hide it
    expect(svc.healthFailures).toBe(0);
  });

  it('treats a thrown fetch (unreachable) as a failure', async () => {
    const svc: Svc = { id: 's1', endpoint: 'https://svc.test', healthCheck: null, healthFailures: 2 };
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await sweepHealth(mockPrisma([svc]), boom as unknown as typeof fetch);
    expect(svc.healthy).toBe(false);
  });
});
