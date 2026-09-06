import type { PrismaClient } from '@clevercon/db';
import type { NormalizedEvent } from './events.js';

/**
 * Persists normalized Soroban events into Postgres and tracks resume cursors.
 * Idempotent: re-seeing an event (same cursor) is skipped.
 */
export class Indexer {
  constructor(private readonly prisma: PrismaClient) {}

  /** Insert new events, skipping any whose cursor already exists. Returns #inserted. */
  async persistEvents(events: NormalizedEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const res = await this.prisma.chainEvent.createMany({
      data: events.map((e) => ({
        contractId: e.contractId,
        type: e.type,
        ledger: e.ledger,
        txHash: e.txHash,
        cursor: e.cursor,
        payload: e.payload as object,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  async getCursor(key: string): Promise<string | null> {
    const row = await this.prisma.indexerState.findUnique({ where: { key } });
    return row?.cursor ?? null;
  }

  async setCursor(key: string, cursor: string): Promise<void> {
    await this.prisma.indexerState.upsert({
      where: { key },
      update: { cursor },
      create: { key, cursor },
    });
  }
}
