import { createHash } from 'crypto';

export interface SettlementRecord {
  rail: 'x402' | 'mpp';
  idempotencyKey: string;
  agentId: string;
  amount: string;
  status: 'PENDING' | 'SETTLED' | 'DUPLICATE_PREVENTED';
  timestamp: number;
}

export class SettlementLedger {
  private static store = new Map<string, SettlementRecord>();

  public static generateKey(taskId: string, stepId: string, rail: string, uniqueHint: string): string {
    return createHash('sha256')
      .update(`${taskId}:${stepId}:${rail}:${uniqueHint}`)
      .digest('hex');
  }

  public static record(record: SettlementRecord): boolean {
    if (this.store.has(record.idempotencyKey)) {
      return false; // Already settled
    }
    this.store.set(record.idempotencyKey, record);
    return true;
  }

  public static get(idempotencyKey: string): SettlementRecord | undefined {
    return this.store.get(idempotencyKey);
  }

  public static clear(): void {
    this.store.clear();
  }
}