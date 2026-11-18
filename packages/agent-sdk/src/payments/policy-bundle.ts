/**
 * A "policy bundle" is the owner's private spending policy in product terms
 * (plain rules + a secret salt). It is the client-side secret that pp/2 proving
 * needs: the salt pins the on-chain commitment, and the rules become the circuit
 * witness. It never leaves the owner/agent, which is what keeps the policy private
 * (the server only ever sees the commitment).
 *
 * This maps the product rule shape (the same `perPaymentCeilingUsdc` /
 * `rollingCapUsdc` / ... the console and `set_limit` use) onto the batch circuit's
 * {@link PolicyWitness}. v1 covers R1 (per-payment ceiling), R2 (rolling cap), and
 * R7 (velocity); allowlist/deny/calendar/category (R3-R6, R8) are follow-ons that
 * need a Merkle/commitment input and are left disabled here.
 */
import type { PolicyWitness } from './batch-prover.js';
import { payeeField } from './policy-codec.js';
import { buildAllowlist, windowsRoot, type Allowlist } from './allowlist.js';
import type { Poseidon } from './poseidon.js';

const STROOPS_PER_USDC = 10_000_000;
const usdcToStroops = (usdc: number): string => String(BigInt(Math.round(usdc * STROOPS_PER_USDC)));

/** The owner's rules, in product (USDC/seconds) terms. R1 is required. */
export interface PolicyBundleRules {
  /** R1: per-payment ceiling in USDC (required; every release must be <=). */
  perPaymentCeilingUsdc: number;
  /** R2: rolling cap in USDC over `rollingWindowSecs` (both or neither). */
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  /** R3/R5/R8: approved payees, each with an optional per-payee cap + category. */
  allowlist?: { payeeAddress: string; perPayeeCapUsdc?: number; category?: number }[];
  /** R4: addresses that may not be paid above `denylistThresholdUsdc` (up to 4). */
  denylist?: string[];
  denylistThresholdUsdc?: number;
  /** R6: up to 2 calendar windows (unix seconds) a release's validity must sit in. */
  calendarWindows?: { startUnix: number; endUnix: number }[];
  /** R7: max number of releases over `velocityWindowSecs` (both or neither). */
  maxReleasesPerWindow?: number;
  velocityWindowSecs?: number;
  /** R8: per-category ceilings in USDC (up to 4; index = category). */
  categoryCeilingsUsdc?: number[];
}

/** The owner's private policy: rules + the secret salt that pins the commitment. */
export interface PolicyBundle {
  rules: PolicyBundleRules;
  /** Decimal field element (< r). Keep private; losing it loses the ability to prove. */
  salt: string;
}

/**
 * A fresh random salt as a decimal field element (< 2^253 < r). Works in Node 20+
 * and browsers (both expose `globalThis.crypto.getRandomValues`). Generate once
 * per policy and store it with the rules as the {@link PolicyBundle}.
 */
export function newSalt(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  b[0] &= 0x1f; // clear the top 3 bits so the value is < 2^253 < r
  let hex = '';
  for (const x of b) hex += x.toString(16).padStart(2, '0');
  return BigInt('0x' + hex).toString();
}

/**
 * Build the circuit {@link PolicyWitness} from a {@link PolicyBundle}. Enables a
 * rule only when its fields are present, so a bare per-payment ceiling yields an
 * R1-only policy (the shape proven live). Amounts are converted USDC -> stroops.
 */
export function policyWitnessFromBundle(bundle: PolicyBundle): PolicyWitness {
  const r = bundle.rules;
  if (!(r.perPaymentCeilingUsdc > 0)) {
    throw new Error('policy bundle requires perPaymentCeilingUsdc > 0 (R1)');
  }
  const r2 = r.rollingCapUsdc != null && r.rollingWindowSecs != null;
  const r7 = r.maxReleasesPerWindow != null && r.velocityWindowSecs != null;
  if ((r.rollingCapUsdc != null) !== (r.rollingWindowSecs != null)) {
    throw new Error('R2 needs both rollingCapUsdc and rollingWindowSecs, or neither');
  }
  if ((r.maxReleasesPerWindow != null) !== (r.velocityWindowSecs != null)) {
    throw new Error('R7 needs both maxReleasesPerWindow and velocityWindowSecs, or neither');
  }
  return {
    enabled: [true, r2, false, false, false, false, r7, false],
    salt: bundle.salt,
    r1Ceiling: usdcToStroops(r.perPaymentCeilingUsdc),
    r2Cap: r2 ? usdcToStroops(r.rollingCapUsdc as number) : '0',
    r2WindowSecs: r2 ? String(r.rollingWindowSecs) : '0',
    r2Delegate: '0',
    r3Root: '0',
    r3Depth: '16',
    r4Entries: ['0', '0', '0', '0'],
    r4Threshold: '0',
    r6WindowsRoot: '0',
    r6Windows: [
      { start: '0', end: '0' },
      { start: '0', end: '0' },
    ],
    r7MaxCount: r7 ? String(r.maxReleasesPerWindow) : '0',
    r7WindowSecs: r7 ? String(r.velocityWindowSecs) : '0',
    r8CatCeilings: ['0', '0', '0', '0'],
    disclosureTag: '0',
  };
}

/**
 * Build the FULL circuit witness for a bundle, including the rules that need
 * Poseidon (R3 allowlist, R5 per-payee cap, R6 calendar, R8 category), using the
 * oracle so JS-built roots match the circuit. Returns the policy witness plus the
 * built {@link Allowlist} (so the caller can attach `membership(payee)` to each
 * release). R1/R2/R4/R7 are field-only and need no Poseidon.
 */
export async function buildPolicyWitness(
  bundle: PolicyBundle,
  poseidon: Poseidon,
): Promise<{ policy: PolicyWitness; allowlist?: Allowlist }> {
  const r = bundle.rules;
  const policy = policyWitnessFromBundle(bundle); // R1/R2/R7 + defaults
  const enabled = [...policy.enabled];
  let allowlist: Allowlist | undefined;

  // R3 allowlist (+ R5 per-payee cap, R8 category, which ride the leaf).
  if (r.allowlist && r.allowlist.length) {
    allowlist = await buildAllowlist(
      r.allowlist.map((e) => ({
        payeeAddress: e.payeeAddress,
        capStroops: e.perPayeeCapUsdc != null ? usdcToStroops(e.perPayeeCapUsdc) : '0',
        category: e.category ?? 0,
      })),
      poseidon,
    );
    policy.r3Root = allowlist.root;
    enabled[2] = true; // R3
    if (r.allowlist.some((e) => e.perPayeeCapUsdc != null)) enabled[4] = true; // R5
    if (r.categoryCeilingsUsdc && r.categoryCeilingsUsdc.length) {
      const cats = ['0', '0', '0', '0'];
      r.categoryCeilingsUsdc.slice(0, 4).forEach((c, i) => (cats[i] = usdcToStroops(c)));
      policy.r8CatCeilings = cats;
      enabled[7] = true; // R8
    }
  }

  // R4 deny-list: compare each payee field against up to four forbidden fields.
  if (r.denylist && r.denylist.length) {
    const entries = r.denylist
      .slice(0, 4)
      .map((a) => BigInt('0x' + payeeField(a).toString('hex')).toString());
    while (entries.length < 4) entries.push('0');
    policy.r4Entries = entries;
    policy.r4Threshold =
      r.denylistThresholdUsdc != null ? usdcToStroops(r.denylistThresholdUsdc) : '0';
    enabled[3] = true; // R4
  }

  // R6 calendar windows: the release validity window must sit inside one of them.
  if (r.calendarWindows && r.calendarWindows.length) {
    const wins = [
      r.calendarWindows[0] ?? { startUnix: 0, endUnix: 0 },
      r.calendarWindows[1] ?? { startUnix: 0, endUnix: 0 },
    ].map((w) => ({ start: String(w.startUnix), end: String(w.endUnix) }));
    policy.r6Windows = wins;
    policy.r6WindowsRoot = await windowsRoot(wins, poseidon);
    enabled[5] = true; // R6
  }

  policy.enabled = enabled;
  return { policy, allowlist };
}
