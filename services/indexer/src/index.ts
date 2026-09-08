import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaClient } from '@clevercon/db';
import { loadConfig } from './config.js';

// Load the repo-root .env so the indexer picks up DATABASE_URL, the RPC URL, and
// INDEXER_* config even when started from the package dir (npm run -w).
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
import { Indexer } from './indexer.js';
import { decodeSorobanEvent } from './events.js';

const STREAM_KEY = 'vault';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.contractIds.length === 0) {
    throw new Error('INDEXER_CONTRACT_IDS is empty; nothing to index');
  }
  const prisma = new PrismaClient();
  const server = new SorobanRpc.Server(cfg.sorobanRpcUrl, { allowHttp: false });
  const indexer = new Indexer(prisma);
  const filters = [{ type: 'contract' as const, contractIds: cfg.contractIds }];

  console.log(
    `[indexer] polling ${cfg.contractIds.length} contract(s) every ${cfg.pollIntervalMs}ms`,
  );

  for (;;) {
    try {
      const cursor = await indexer.getCursor(STREAM_KEY);
      const request = (
        cursor
          ? { filters, cursor, limit: 100 }
          : { filters, startLedger: cfg.startLedger, limit: 100 }
      ) as SorobanRpc.Api.GetEventsRequest;

      const res = await server.getEvents(request);
      const inserted = await indexer.persistEvents(res.events.map(decodeSorobanEvent));
      if (res.cursor) await indexer.setCursor(STREAM_KEY, res.cursor);
      if (inserted > 0) console.log(`[indexer] stored ${inserted} events (cursor=${res.cursor})`);
    } catch (err) {
      console.error('[indexer] poll error:', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  }
}

void main();
