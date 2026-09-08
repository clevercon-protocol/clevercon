import { Prisma, type PrismaClient } from '@clevercon/db';
import type { NormalizedEvent } from './events.js';

/** Vault event payload shape (see events.ts decodeSorobanEvent). */
interface VaultEventPayload {
  topics: unknown[]; // [user, asset]
  data: { amount?: string } | null;
}

const DEPOSIT = 'deposit_event';
const WITHDRAW = 'withdraw_event';

// On-chain amounts are in stroops (1 USDC = 10,000,000). The mirror stores USDC
// (Decimal(20,7)), matching how the API and UI read balances, so convert here.
const STROOPS_PER_USDC = new Prisma.Decimal(10_000_000);

/**
 * Persists normalized Soroban events into Postgres, projects vault deposit and
 * withdraw events into the `vault_accounts` mirror, and tracks resume cursors.
 * Idempotent: an event (unique cursor) is inserted and projected at most once,
 * so replaying a ledger range never double-counts a balance.
 */
export class Indexer {
  constructor(private readonly prisma: PrismaClient) {}

  /** Insert new events (skipping already-seen cursors) and project them. Returns #new. */
  async persistEvents(events: NormalizedEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    // Only act on events we have not already recorded, so projection is exactly-once.
    const seen = await this.prisma.chainEvent.findMany({
      where: { cursor: { in: events.map((e) => e.cursor) } },
      select: { cursor: true },
    });
    const seenCursors = new Set(seen.map((r) => r.cursor));
    const fresh = events.filter((e) => !seenCursors.has(e.cursor));
    if (fresh.length === 0) return 0;

    await this.prisma.chainEvent.createMany({
      data: fresh.map((e) => ({
        contractId: e.contractId,
        type: e.type,
        ledger: e.ledger,
        txHash: e.txHash,
        cursor: e.cursor,
        payload: e.payload as object,
      })),
      skipDuplicates: true,
    });

    await this.projectVaultBalances(fresh);
    return fresh.length;
  }

  /**
   * Mirror on-chain vault balances from deposit/withdraw events. On-chain is the
   * source of truth; this keeps the queryable Postgres mirror in step so the API
   * (GET /vault) can read balances without hitting the chain on the hot path.
   */
  private async projectVaultBalances(events: NormalizedEvent[]): Promise<void> {
    for (const e of events) {
      if (e.type !== DEPOSIT && e.type !== WITHDRAW) continue;
      const payload = e.payload as VaultEventPayload;
      const address = String(payload.topics?.[0] ?? '');
      const asset = String(payload.topics?.[1] ?? '');
      const raw = payload.data?.amount;
      if (!address || !asset || raw == null) continue;

      const amount = new Prisma.Decimal(raw).div(STROOPS_PER_USDC);
      if (e.type === DEPOSIT) {
        await this.prisma.vaultAccount.upsert({
          where: { address_asset: { address, asset } },
          create: { address, asset, balance: amount, totalDeposited: amount },
          update: {
            balance: { increment: amount },
            totalDeposited: { increment: amount },
          },
        });
      } else {
        await this.prisma.vaultAccount.upsert({
          where: { address_asset: { address, asset } },
          // A withdraw for an unseen account should not create a negative row.
          create: { address, asset, balance: new Prisma.Decimal(0) },
          update: { balance: { decrement: amount } },
        });
      }
    }
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
