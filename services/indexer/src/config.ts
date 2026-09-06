import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  // Comma-separated contract ids to index (vault, policy-verifier, ...).
  INDEXER_CONTRACT_IDS: z.string().default(''),
  INDEXER_START_LEDGER: z.coerce.number().int().positive().optional(),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(5000),
});

export interface IndexerConfig {
  databaseUrl: string;
  sorobanRpcUrl: string;
  contractIds: string[];
  startLedger?: number;
  pollIntervalMs: number;
}

export function loadConfig(env: Record<string, unknown> = process.env): IndexerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid indexer configuration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    databaseUrl: c.DATABASE_URL,
    sorobanRpcUrl: c.SOROBAN_RPC_URL,
    contractIds: c.INDEXER_CONTRACT_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    startLedger: c.INDEXER_START_LEDGER,
    pollIntervalMs: c.INDEXER_POLL_MS,
  };
}
