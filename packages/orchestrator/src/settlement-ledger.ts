import { createHash } from 'crypto';

export type PaymentRail = 'x402' | 'mpp';
export type SettlementStatus = 'PENDING' | 'SETTLED' | 'DUPLICATE_PREVENTED' | 'FAILED';

export interface SettlementRecord {
  rail: PaymentRail;
  idempotencyKey: string;
  taskId: string;
  stepId: string;
  agentId: string;
  amount: string;
  status: SettlementStatus;
  timestamp: number;
}

/**
 * Interface defining the contract for durable settlement storage backends.
 */
export interface IDurableSettlementStore {
  save(record: SettlementRecord): Promise<void>;
  getByempotencyKey(idempotencyKey: string): Promise<SettlementRecord | null>;
  getByStepId(taskId: string, stepId: string): Promise<SettlementRecord[]>;
}

/**
 * In-memory fallback implementation of the durable store for local dev and testing.
 */
export class InMemorySettlementStore implements IDurableSettlementStore {
  private store = new Map<string, SettlementRecord>();

  async save(record: SettlementRecord): Promise<void> {
    this.store.set(record.idempotencyKey, record);
  }

  async getByempotencyKey(idempotencyKey: string): Promise<SettlementRecord | null> {
    return this.store.get(idempotencyKey) || null;
  }

  async getByStepId(taskId: string, stepId: string): Promise<SettlementRecord[]> {
    const results: SettlementRecord[] = [];
    for (const record of this.store.values()) {
      if (record.taskId === taskId && record.stepId === stepId) {
        results.push(record);
      }
    }
    return results;
  }
}

/**
 * Settlement Ledger manager providing idempotency checks and ledger logging.
 */
export class SettlementLedgerManager {
  constructor(private readonly store: IDurableSettlementStore) {}

  public static generateKey(taskId: string, stepId: string, rail: PaymentRail, uniqueHint: string): string {
    return createHash('sha256')
      .update(`${taskId}:${stepId}:${rail}:${uniqueHint}`)
      .digest('hex');
  }

  public async registerOrDeduplicate(record: SettlementRecord): Promise<{ isDuplicate: boolean; record: SettlementRecord }> {
    const existing = await this.store.getByempotencyKey(record.idempotencyKey);
    
    if (existing) {
      return {
        isDuplicate: true,
        record: { ...existing, status: 'DUPLICATE_PREVENTED' },
      };
    }

    await this.store.save(record);
    return {
      isDuplicate: false,
      record,
    };
  }

  public async getStepSettlements(taskId: string, stepId: string): Promise<SettlementRecord[]> {
    return this.store.getByStepId(taskId, stepId);
  }
}