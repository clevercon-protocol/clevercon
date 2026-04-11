/**
 * Orchestrator store — persists per-user orchestrator records in data/orchestrators.json.
 *
 * Each user gets exactly one orchestrator keypair, generated on first creation.
 * The secret key is stored in plaintext for the hackathon.
 * In production this should be encrypted at rest.
 */

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(path.resolve(process.argv[1]));
// process.argv[1] = .../packages/orchestrator/src/server.ts → go up 3 levels to workspace root
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'orchestrators.json');

export interface OrchestratorRecord {
  user_address: string;
  orchestrator_name: string;
  orchestrator_pubkey: string;
  orchestrator_secret: string;
  system_prompt?: string;
  registered_on_chain: boolean;
  created_at: string;
}

type Store = Record<string, OrchestratorRecord>; // keyed by user_address

// In-memory cache — reloaded on writes
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, '{}', 'utf8');
    }
    cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

function save(store: Store): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  cache = store;
}

export function getByUser(userAddress: string): OrchestratorRecord | null {
  return load()[userAddress] ?? null;
}

export function getByOrchestratorPubkey(pubkey: string): OrchestratorRecord | null {
  const store = load();
  return Object.values(store).find(r => r.orchestrator_pubkey === pubkey) ?? null;
}

export function upsert(record: OrchestratorRecord): void {
  const store = load();
  store[record.user_address] = record;
  save(store);
}

export function markRegisteredOnChain(userAddress: string): void {
  const store = load();
  if (store[userAddress]) {
    store[userAddress].registered_on_chain = true;
    save(store);
  }
}

export function all(): OrchestratorRecord[] {
  return Object.values(load());
}
