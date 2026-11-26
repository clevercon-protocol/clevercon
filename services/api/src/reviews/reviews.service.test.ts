import { describe, it, expect, vi } from 'vitest';
import { ReviewsService } from './reviews.service.js';

type Ctor = ConstructorParameters<typeof ReviewsService>;

/** A task row the gating reads: buyer, status, its steps, and its payments. */
function taskRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    buyerId: 'buyer1',
    status: 'COMPLETED',
    steps: [{ id: 'step1', serviceId: 'svc1' }],
    payments: [{ stepId: 'step1', status: 'CONFIRMED' }],
    ...over,
  };
}

function makeService(opts: { task?: unknown; existingReview?: unknown }) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    task: { findUnique: vi.fn(async () => opts.task ?? null) },
    review: {
      findUnique: vi.fn(async () => opts.existingReview ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: 'r1',
          ...data,
          respondedAt: null,
          createdAt: new Date('2026-11-26T00:00:00Z'),
          author: { displayName: 'Buyer One', handle: null },
        };
      }),
      aggregate: vi.fn(async () => ({ _avg: { rating: 4.5 }, _count: { _all: 2 } })),
    },
    serviceReputation: { upsert: vi.fn(async () => ({})) },
    service: {
      findUnique: vi.fn(async () => ({ providerId: 'prov1', ownerOrg: null })),
    },
  } as unknown as Ctor[0];
  return { svc: new ReviewsService(prisma), prisma, created };
}

const good = { serviceId: 'svc1', taskId: 'task1', rating: 5, text: 'great' };

describe('ReviewsService.create (anti-Sybil gating)', () => {
  it('rejects a task that is not found', async () => {
    const { svc } = makeService({ task: null });
    await expect(svc.create('buyer1', good)).rejects.toThrow(/not found/i);
  });

  it('rejects a review from someone other than the buyer', async () => {
    const { svc } = makeService({ task: taskRow() });
    await expect(svc.create('someone-else', good)).rejects.toThrow(/not your hire/i);
  });

  it('rejects when the hire did not use that service', async () => {
    const { svc } = makeService({
      task: taskRow({ steps: [{ id: 'step1', serviceId: 'other' }] }),
    });
    await expect(svc.create('buyer1', good)).rejects.toThrow(/did not use/i);
  });

  it('rejects when the hire has not settled (no confirmed payment)', async () => {
    const { svc } = makeService({
      task: taskRow({ status: 'RUNNING', payments: [{ stepId: 'step1', status: 'PENDING' }] }),
    });
    await expect(svc.create('buyer1', good)).rejects.toThrow(/settled/i);
  });

  it('rejects a second review for the same hire', async () => {
    const { svc } = makeService({ task: taskRow(), existingReview: { id: 'existing' } });
    await expect(svc.create('buyer1', good)).rejects.toThrow(/already reviewed/i);
  });

  it('creates a review for a settled hire and recomputes the rating', async () => {
    const { svc, prisma, created } = makeService({ task: taskRow() });
    const out = await svc.create('buyer1', good);
    expect(created[0]).toMatchObject({ serviceId: 'svc1', taskId: 'task1', rating: 5 });
    expect(out.rating).toBe(5);
    // Rating folded into the denormalized reputation (avg of 4.5 over 2 reviews).
    expect(
      (prisma.serviceReputation.upsert as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ update: { avgRating: 4.5, reviewCount: 2 } });
  });

  it('accepts a metered hire settled via a confirmed payment without a step link', async () => {
    const { svc } = makeService({
      task: taskRow({ payments: [{ stepId: null, status: 'CONFIRMED' }] }),
    });
    const out = await svc.create('buyer1', good);
    expect(out.rating).toBe(5);
  });
});
