/**
 * Vault Ledger — persists per-user vault transactions.
 * Tracks deposits, withdrawals, and agent payments with real amounts and tx hashes.
 */

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR  = path.join(__dirname, '..', '..', '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'vault-ledger.json');

export type VaultTxType = 'deposit' | 'withdrawal' | 'payment' | 'budget_lock';

export interface VaultLedgerEntry {
  id: string;
  user_address: string;
  type: VaultTxType;
  amount_usdc: number;          // always positive; sign implied by type (deposit=credit, others=debit)
  tx_hash?: string;
  task_id?: string;
  agent_name?: string;          // for payment entries
  timestamp: string;
}

type Ledger = VaultLedgerEntry[];

let cache: Ledger | null = null;

function load(): Ledger {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LEDGER_PATH)) fs.writeFileSync(LEDGER_PATH, '[]', 'utf8');
    cache = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  } catch {
    cache = [];
  }
  return cache;
}

function save(ledger: Ledger): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed = ledger.slice(-2000);
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  cache = trimmed;
}

let _seq = 0;
function nextId(): string {
  return `vlt_${Date.now()}_${++_seq}`;
}

export function appendVaultTx(entry: Omit<VaultLedgerEntry, 'id' | 'timestamp'>): VaultLedgerEntry {
  const ledger = load();
  const record: VaultLedgerEntry = {
    ...entry,
    id: nextId(),
    timestamp: new Date().toISOString(),
  };
  ledger.push(record);
  save(ledger);
  return record;
}

export function getVaultLedger(userAddress: string, limit = 100): VaultLedgerEntry[] {
  const ledger = load();
  return ledger
    .filter(e => e.user_address === userAddress)
    .slice(-limit)
    .reverse();
}

export function clearVaultLedger(): void {
  save([]);
}
