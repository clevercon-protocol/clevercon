/**
 * Build the spend-policy allowlist exactly as the circuit expects it, using the
 * Poseidon oracle so the JS-built tree matches the in-circuit hash. The allowlist
 * is a depth-16 sparse Merkle:
 *   leaf = Poseidon3(payee_field, per_payee_cap, category)   (R3 + R5 + R8)
 *   node = Poseidon2(left, right)
 *   empty subtrees use precomputed zero-hashes
 * The committed root is a policy field; each allowlisted payee gets an
 * authentication path that `release_payment_proved_batch` checks per release.
 */
import { payeeField } from './policy-codec.js';
import type { Poseidon } from './poseidon.js';
import type { AllowlistMembership } from './batch-prover.js';

const DEPTH = 16;
const pf = (addr: string): bigint => BigInt('0x' + payeeField(addr).toString('hex'));

/** One approved payee, with its optional per-payee cap (R5) and category (R8). */
export interface AllowlistEntry {
  payeeAddress: string;
  /** R5 per-payee cap in stroops; '0' when unused. */
  capStroops?: string;
  /** R8 category index (0..C-1). */
  category?: number;
}

/** A built allowlist: the committed Merkle root + a per-address membership lookup. */
export interface Allowlist {
  root: string;
  membership(payeeAddress: string): AllowlistMembership | undefined;
}

/** Build the allowlist tree and each entry's authentication path. */
export async function buildAllowlist(
  entries: AllowlistEntry[],
  poseidon: Poseidon,
  depth = DEPTH,
): Promise<Allowlist> {
  if (entries.length === 0) throw new Error('allowlist must have at least one entry');

  // Zero-subtree hash at each level: zero[0] = 0, zero[d] = P2(zero[d-1], zero[d-1]).
  const zero: bigint[] = [0n];
  for (let d = 1; d <= depth; d++) zero[d] = await poseidon.p2(zero[d - 1], zero[d - 1]);

  // Leaves in entry order.
  const leaves: bigint[] = [];
  for (const e of entries) {
    leaves.push(
      await poseidon.p3(pf(e.payeeAddress), BigInt(e.capStroops ?? '0'), BigInt(e.category ?? 0)),
    );
  }

  // Build every level, padding a missing right sibling with that level's zero hash.
  const levels: bigint[][] = [leaves.slice()];
  for (let d = 0; d < depth; d++) {
    const cur = levels[d];
    const next: bigint[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const l = cur[i];
      const r = i + 1 < cur.length ? cur[i + 1] : zero[d];
      next.push(await poseidon.p2(l, r));
    }
    levels.push(next.length ? next : [zero[d + 1]]);
  }
  const root = levels[depth][0].toString();

  // First index of each address.
  const indexOf = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!indexOf.has(e.payeeAddress)) indexOf.set(e.payeeAddress, i);
  });

  return {
    root,
    membership(payeeAddress: string): AllowlistMembership | undefined {
      const start = indexOf.get(payeeAddress);
      if (start === undefined) return undefined;
      const e = entries[start];
      const pathElements: string[] = [];
      const pathIndices: number[] = [];
      let idx = start;
      for (let d = 0; d < depth; d++) {
        const level = levels[d];
        const sibIdx = idx ^ 1;
        const sib = sibIdx < level.length ? level[sibIdx] : zero[d];
        pathElements.push(sib.toString());
        pathIndices.push(idx & 1); // 0 = this node is the left child
        idx >>= 1;
      }
      return { pathElements, pathIndices, cap: e.capStroops ?? '0', category: e.category ?? 0 };
    },
  };
}

/** R6 calendar windows root = Poseidon(2*W) over [start0,end0,start1,end1] (W=2). */
export async function windowsRoot(
  windows: { start: string; end: string }[],
  poseidon: Poseidon,
): Promise<string> {
  const flat = windows.flatMap((w) => [BigInt(w.start), BigInt(w.end)]);
  if (flat.length !== 4) throw new Error('expected exactly 2 calendar windows (Poseidon4)');
  return (await poseidon.p4(flat[0], flat[1], flat[2], flat[3])).toString();
}
