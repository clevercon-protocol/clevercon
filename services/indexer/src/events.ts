import { scValToNative, type xdr } from '@stellar/stellar-sdk';

export interface NormalizedEvent {
  contractId: string;
  type: string;
  ledger: bigint;
  txHash: string;
  cursor: string;
  payload: unknown;
}

interface RawSorobanEvent {
  // The SDK passes a Contract object here, not a string; coerced below.
  contractId?: unknown;
  topic?: xdr.ScVal[];
  value?: xdr.ScVal;
  ledger?: number | string;
  id?: string;
  txHash?: string;
}

/** Coerce the SDK's contractId (string | Contract) to its C... string. */
function toContractId(c: unknown): string {
  if (!c) return '';
  if (typeof c === 'string') return c;
  const maybe = c as { contractId?: () => string; toString?: () => string };
  if (typeof maybe.contractId === 'function') return maybe.contractId();
  const s = typeof maybe.toString === 'function' ? maybe.toString() : '';
  return s.startsWith('C') ? s : '';
}

/** Recursively make a decoded value JSON-safe (bigint -> string) for Prisma Json. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
}

function decode(v?: xdr.ScVal): unknown {
  if (!v) return null;
  try {
    return scValToNative(v);
  } catch {
    return null;
  }
}

/** Normalize a Soroban RPC event into our ChainEvent shape. */
export function decodeSorobanEvent(raw: RawSorobanEvent): NormalizedEvent {
  const topics = raw.topic ?? [];
  const type = topics.length ? String(decode(topics[0])) : 'unknown';
  const restTopics = topics.slice(1).map(decode);
  return {
    contractId: toContractId(raw.contractId),
    type,
    ledger: BigInt(raw.ledger ?? 0),
    txHash: raw.txHash ?? '',
    cursor: raw.id ?? '',
    payload: jsonSafe({ topics: restTopics, data: decode(raw.value) }),
  };
}
