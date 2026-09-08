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
 *
 * Exactly-once and concurrency-safe: each event is inserted and projected in one
 * transaction, guarded by the unique `chain_events.cursor`. If two indexer
 * instances (or a replayed range) process the same event, exactly one commits
 * the insert-and-project; the other loses the unique race and is skipped. So a
 * balance is never double-counted, even when the indexer is scaled out.
 */
export class Indexer {
  constructor(private readonly prisma: PrismaClient) {}

  /** Insert new events and project each, exactly once. Returns #newly-applied. */
  async persistEvents(events: NormalizedEvent[]): Promise<number> {
    let applied = 0;
    for (const e of events) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // The unique cursor is the guard: a duplicate insert throws P2002 and
          // rolls back the whole transaction, including the balance projection.
          await tx.chainEvent.create({
            data: {
              contractId: e.contractId,
              type: e.type,
              ledger: e.ledger,
              txHash: e.txHash,
              cursor: e.cursor,
              payload: e.payload as object,
            },
          });
          await this.projectVaultEvent(tx, e);
        });
        applied += 1;
      } catch (err) {
        // Already recorded (by us on a prior poll, or a concurrent instance).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    return applied;
  }

  /**
   * Mirror one on-chain vault event into `vault_accounts`, within the caller's
   * transaction. On-chain is the source of truth; this keeps the queryable
   * Postgres mirror in step so the API reads balances without hitting the chain.
   */
  private async projectVaultEvent(tx: Prisma.TransactionClient, e: NormalizedEvent): Promise<void> {
    if (e.type !== DEPOSIT && e.type !== WITHDRAW) return;
    const payload = e.payload as VaultEventPayload;
    const address = String(payload.topics?.[0] ?? '');
    const asset = String(payload.topics?.[1] ?? '');
    const raw = payload.data?.amount;
    if (!address || !asset || raw == null) return;

    const amount = new Prisma.Decimal(raw).div(STROOPS_PER_USDC);
    if (e.type === DEPOSIT) {
      await tx.vaultAccount.upsert({
        where: { address_asset: { address, asset } },
        create: { address, asset, balance: amount, totalDeposited: amount },
        update: {
          balance: { increment: amount },
          totalDeposited: { increment: amount },
        },
      });
    } else {
      await tx.vaultAccount.upsert({
        where: { address_asset: { address, asset } },
        // A withdraw for an unseen account should not create a negative row.
        create: { address, asset, balance: new Prisma.Decimal(0) },
        update: { balance: { decrement: amount } },
      });
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
