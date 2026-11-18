import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { AgentService } from './agent.service.js';

type Ctor = ConstructorParameters<typeof AgentService>;

function makeService(available: number) {
  const prisma = {
    service: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  } as unknown as Ctor[0];
  const vault = { getForUser: vi.fn(async () => ({ available })) } as unknown as Ctor[1];
  const policies = { list: vi.fn(async () => ({ items: [] })) } as unknown as Ctor[2];
  return new AgentService(prisma, vault, policies);
}

const G = () => Keypair.random().publicKey();

describe('AgentService (fallback, no API key)', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it('parses a direct payment with a valid address', async () => {
    const svc = makeService(10);
    const payee = G();
    const plan = await svc.plan('u1', `pay 5 to ${payee} for design`);
    expect(plan.kind).toBe('pay');
    expect(plan.source).toBe('fallback');
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ payee, amount: 5, reason: 'design' });
    expect(plan.warnings).toHaveLength(0);
  });

  it('warns when the amount exceeds available budget', async () => {
    const svc = makeService(2);
    const plan = await svc.plan('u1', `send 5 usdc to ${G()}`);
    expect(plan.kind).toBe('pay');
    expect(plan.warnings.join(' ')).toMatch(/available/i);
  });

  it('returns none for a non-address recipient (never invents one)', async () => {
    const svc = makeService(10);
    const plan = await svc.plan('u1', 'pay 5 to Alice');
    expect(plan.kind).toBe('none');
    expect(plan.lines).toHaveLength(0);
  });

  it('returns none for a non-spending instruction', async () => {
    const svc = makeService(10);
    const plan = await svc.plan('u1', "what's the weather today?");
    expect(plan.kind).toBe('none');
  });

  it('returns none for an empty instruction', async () => {
    const svc = makeService(10);
    const plan = await svc.plan('u1', '   ');
    expect(plan.kind).toBe('none');
  });
});
