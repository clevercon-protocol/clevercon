import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { TasksService } from './tasks.service.js';

// A real, parseable Stellar public key (validated by StrKey regex in the service).
const G = () => Keypair.random().publicKey();

function svcWith(policyRuleSummary?: unknown) {
  const prisma = {
    policy: {
      findFirst: vi.fn(async () =>
        policyRuleSummary === undefined
          ? null
          : { id: 'pol1', userId: 'u1', commitment: 'c', ruleSummary: policyRuleSummary },
      ),
    },
  };
  // Other deps are @Optional(); validation runs before any of them are used.
  return new TasksService(prisma as unknown as ConstructorParameters<typeof TasksService>[0]);
}

describe('createPayment validation', () => {
  it('rejects an empty line list', async () => {
    await expect(svcWith().createPayment('u1', { kind: 'pay', lines: [] })).rejects.toThrow(
      /at least one valid/i,
    );
  });

  it('rejects a single payment with more than one line', async () => {
    await expect(
      svcWith().createPayment('u1', {
        kind: 'pay',
        lines: [
          { payee: G(), amount: 1 },
          { payee: G(), amount: 1 },
        ],
      }),
    ).rejects.toThrow(/exactly one line/i);
  });

  it('rejects an invalid payee address', async () => {
    await expect(
      svcWith().createPayment('u1', {
        kind: 'pay',
        lines: [{ payee: 'not-an-address', amount: 1 }],
      }),
    ).rejects.toThrow(/invalid payee/i);
  });

  it('rejects a line above the policy per-payment cap', async () => {
    await expect(
      svcWith({ perPaymentCeilingUsdc: 1 }).createPayment('u1', {
        kind: 'pay',
        lines: [{ payee: G(), amount: 5 }],
        policyId: 'pol1',
      }),
    ).rejects.toThrow(/per-payment cap/i);
  });

  it('rejects a payee not on the policy allowlist', async () => {
    const allowed = G();
    await expect(
      svcWith({ allowlist: [allowed] }).createPayment('u1', {
        kind: 'pay',
        lines: [{ payee: G(), amount: 1 }],
        policyId: 'pol1',
      }),
    ).rejects.toThrow(/allowlist/i);
  });

  it('rejects an unknown policyId', async () => {
    await expect(
      svcWith(undefined).createPayment('u1', {
        kind: 'pay',
        lines: [{ payee: G(), amount: 1 }],
        policyId: 'missing',
      }),
    ).rejects.toThrow(/unknown policy/i);
  });
});
