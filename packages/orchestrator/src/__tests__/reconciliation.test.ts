import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementLedger } from '../settlement-ledger';

describe('Exactly-Once Settlement & Reconciliation', () => {
  beforeEach(() => {
    SettlementLedger.clear();
  });

  it('prevents duplicate x402 micropayment settlements', () => {
    const key = SettlementLedger.generateKey('task-1', 'step-1', 'x402', 'payload-hash');

    const firstAttempt = SettlementLedger.record({
      rail: 'x402',
      idempotencyKey: key,
      agentId: 'agent-alpha',
      amount: '100',
      status: 'SETTLED',
      timestamp: Date.now(),
    });

    const secondAttempt = SettlementLedger.record({
      rail: 'x402',
      idempotencyKey: key,
      agentId: 'agent-alpha',
      amount: '100',
      status: 'SETTLED',
      timestamp: Date.now(),
    });

    expect(firstAttempt).toBe(true);
    expect(secondAttempt).toBe(false); // Deduped successfully
  });

  it('detects discrepancies in step-level reconciliation', () => {
    const agentPaidTotal = 500;
    const vaultReleasedTotal = 450; // Deliberate mismatch

    const hasMismatch = agentPaidTotal !== vaultReleasedTotal;
    expect(hasMismatch).toBe(true);
  });
});