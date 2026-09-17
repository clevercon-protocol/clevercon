import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('@clevercon/common', () => ({
  writeJsonSafe: vi.fn(),
}));

vi.mock('./agent-vault-client.js', () => ({
  getAccount: vi.fn(),
}));

vi.mock('./orchestrator-store.js', () => ({
  all: vi.fn(),
}));

vi.mock('./vault-ledger.js', () => ({
  getAllVaultTx: vi.fn(),
  appendVaultTx: vi.fn(),
  isLedgerAtRetentionCap: vi.fn(() => false),
}));

import { getAccount } from './agent-vault-client.js';
import * as orchestratorStore from './orchestrator-store.js';
import { getAllVaultTx, appendVaultTx } from './vault-ledger.js';
import { computeUserDrift, runReconciliation, getReconciliationSummary } from './reconciliation.js';

const USER = 'GABC123';

function ledgerEntry(
  type: 'deposit' | 'withdrawal' | 'payment' | 'budget_lock' | 'adjustment',
  amount: number,
  extra: {
    adjustment_target?: 'balance' | 'spent';
    adjustment_direction?: 'increase' | 'decrease';
  } = {},
) {
  return {
    id: 'x',
    user_address: USER,
    type,
    amount_usdc: amount,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function orchRecord() {
  return {
    user_address: USER,
    orchestrator_name: 'test',
    orchestrator_pubkey: 'pk',
    orchestrator_secret: 'sk',
    registered_on_chain: true,
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeUserDrift', () => {
  it('reports no drift when local ledger matches chain', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 20,
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
    expect(drift.diffs).toHaveLength(0);
  });

  it('classifies balance_mismatch when local balance differs from chain', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([ledgerEntry('deposit', 100)]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 90,
      available: 90,
      locked: 0,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(true);
    const d = drift.diffs.find((x) => x.type === 'balance_mismatch');
    expect(d).toBeDefined();
    expect(d!.local_value).toBeCloseTo(100);
    expect(d!.chain_value).toBeCloseTo(90);
    expect(d!.delta_usdc).toBeCloseTo(-10);
  });

  it('classifies spent_mismatch when local spend differs from chain total_spent', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 25,
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(true);
    const d = drift.diffs.find((x) => x.type === 'spent_mismatch');
    expect(d).toBeDefined();
    expect(d!.local_value).toBeCloseTo(20);
    expect(d!.chain_value).toBeCloseTo(25);
  });

  it('applies adjustment entries to the correct total based on their target', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
      ledgerEntry('adjustment', 5, {
        adjustment_target: 'spent',
        adjustment_direction: 'increase',
      }),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 80,
      available: 80,
      locked: 0,
      total_deposited: 100,
      total_spent: 25, // local spent = 20 + 5 adjustment = 25, matches chain
      active_tasks_count: 0,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
  });

  it('treats budget_lock entries as informational (no balance/spend effect)', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('budget_lock', 30),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 100,
      available: 70,
      locked: 30,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 1,
    });

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
  });

  it('treats a user with no on-chain account as zero balance/spend', async () => {
    vi.mocked(getAllVaultTx).mockReturnValue([]);
    vi.mocked(getAccount).mockResolvedValue(null);

    const drift = await computeUserDrift(USER);

    expect(drift.drift).toBe(false);
    expect(drift.chain.balance_usdc).toBe(0);
  });
});

describe('runReconciliation', () => {
  it('dry-run mode reports drift but never calls appendVaultTx', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([orchRecord()]);
    vi.mocked(getAllVaultTx).mockReturnValue([ledgerEntry('deposit', 100)]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 50,
      available: 50,
      locked: 0,
      total_deposited: 100,
      total_spent: 0,
      active_tasks_count: 0,
    });

    const report = await runReconciliation();

    expect(report.mode).toBe('dry-run');
    expect(report.users_with_drift).toBe(1);
    expect(report.repaired_count).toBe(0);
    expect(appendVaultTx).not.toHaveBeenCalled();
  });

  it('repair mode corrects both balance_mismatch and spent_mismatch independently', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([orchRecord()]);
    vi.mocked(getAllVaultTx).mockReturnValue([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 50, // local computes 80 -> balance drift
      available: 50,
      locked: 0,
      total_deposited: 100,
      total_spent: 25, // local computes 20 -> spent drift
      active_tasks_count: 0,
    });

    const report = await runReconciliation({ repair: true });

    expect(report.mode).toBe('repair');
    expect(report.repaired_count).toBe(2); // both diffs corrected

    expect(appendVaultTx).toHaveBeenCalledWith(
      expect.objectContaining({
        user_address: USER,
        type: 'adjustment',
        adjustment_target: 'balance',
      }),
    );
    expect(appendVaultTx).toHaveBeenCalledWith(
      expect.objectContaining({
        user_address: USER,
        type: 'adjustment',
        adjustment_target: 'spent',
      }),
    );

    const summary = getReconciliationSummary();
    expect(summary.last_mode).toBe('repair');
    expect(summary.drift_count).toBe(1);
  });

  it('is idempotent: replaying the applied adjustments makes a second repair a no-op', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([orchRecord()]);
    // First run: drift on both balance and spend.
    vi.mocked(getAllVaultTx).mockReturnValueOnce([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
    ]);
    vi.mocked(getAccount).mockResolvedValue({
      balance: 50,
      available: 50,
      locked: 0,
      total_deposited: 100,
      total_spent: 25,
      active_tasks_count: 0,
    });

    const first = await runReconciliation({ repair: true });
    expect(first.repaired_count).toBe(2);

    // Second run: ledger now includes the two corrective adjustment entries
    // the first run appended -- local should now match chain exactly.
    vi.mocked(getAllVaultTx).mockReturnValueOnce([
      ledgerEntry('deposit', 100),
      ledgerEntry('payment', 20),
      ledgerEntry('adjustment', 30, {
        adjustment_target: 'balance',
        adjustment_direction: 'decrease',
      }),
      ledgerEntry('adjustment', 5, {
        adjustment_target: 'spent',
        adjustment_direction: 'increase',
      }),
    ]);

    vi.mocked(appendVaultTx).mockClear();
    const second = await runReconciliation({ repair: true });

    expect(second.users_with_drift).toBe(0);
    expect(second.repaired_count).toBe(0);
    expect(appendVaultTx).not.toHaveBeenCalled();
  });

  it('surfaces ledger_at_retention_cap on the report', async () => {
    vi.mocked(orchestratorStore.all).mockReturnValue([]);
    const report = await runReconciliation();
    expect(report).toHaveProperty('ledger_at_retention_cap');
  });
});
