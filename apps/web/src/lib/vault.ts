import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';
import { signTransaction } from './wallet';
import { demoVault } from './demo';

export interface Vault {
  balance: number;
  available: number;
  locked: number;
}

/** The session's vault position: demo data in demo mode, the live API otherwise. */
export async function getVault(): Promise<Vault> {
  if (isDemo()) {
    return {
      balance: demoVault.balanceUsdc,
      available: demoVault.availableUsdc,
      locked: demoVault.lockedUsdc,
    };
  }
  const res = await apiFetch<{ balance: number; available: number; locked: number }>('/vault');
  return { balance: res.balance, available: res.available, locked: res.locked };
}

export interface VaultStatus {
  depositsEnabled: boolean;
  contractAddress: string;
  /** The USDC Stellar Asset Contract id (for building self-custody agent-key tokens). */
  usdcSac: string;
}

/** Deposit availability + the deployed contract address (empty in demo/unconfigured). */
export async function getVaultStatus(): Promise<VaultStatus> {
  if (isDemo()) return { depositsEnabled: false, contractAddress: '', usdcSac: '' };
  return apiFetch<VaultStatus>('/vault/status');
}

interface BuildResp {
  xdr: string;
  networkPassphrase: string;
}

/**
 * Deposit into (or withdraw from) the vault with ONE wallet signature: the API
 * builds an unsigned XDR, the wallet signs that exact operation, the API submits.
 * No separate step-up prompt: the operation XDR carries `user.require_auth()`, so it
 * is inert until the wallet signs it; signing the real op IS the authorization. On-
 * chain is the source of truth, so the mirrored balance updates once the indexer
 * catches the event.
 */
async function signAndSubmit(path: '/vault/deposit' | '/vault/withdraw', amountUsdc: number) {
  const built = await apiFetch<BuildResp>(path, {
    method: 'POST',
    body: JSON.stringify({ amountUsdc }),
  });
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

export function depositToVault(amountUsdc: number): Promise<{ txHash: string }> {
  return signAndSubmit('/vault/deposit', amountUsdc);
}

export function withdrawFromVault(amountUsdc: number): Promise<{ txHash: string }> {
  return signAndSubmit('/vault/withdraw', amountUsdc);
}

export interface Delegate {
  orchestrator: string | null;
  settlementEnabled: boolean;
  registered: boolean;
}

/** The user's spending delegate (provisioned on first read). */
export async function getDelegate(): Promise<Delegate> {
  if (isDemo()) return { orchestrator: null, settlementEnabled: false, registered: false };
  return apiFetch<Delegate>('/vault/delegate');
}

/**
 * Authorize the user's delegate once (register_orchestrator): the API builds the
 * XDR, the wallet signs it, the API submits, then we confirm it. After this the
 * delegate can lock and pay within the user's policy without further prompts,
 * bounded by the vault so it can never overspend.
 */
export async function authorizeDelegate(): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>('/vault/delegate/register', {});
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  const res = await apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
  await apiPost('/vault/delegate/confirm', {});
  return res;
}

/**
 * Pin a rule's commitment to the user's vault account (set_policy_commitment):
 * the API builds the XDR, the wallet signs it, the API submits. Required before
 * a proof-gated release will accept the rule, the vault enforces pinned-set
 * membership, so the operator cannot lock a task under an unpinned rule.
 */
export async function pinCommitment(commitment: string): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>('/vault/pin-commitment', { commitment });
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

/** The user's on-chain pinned-commitment set (hex), so the dapp marks which rules are live. */
export async function getPinnedCommitments(): Promise<string[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ commitments: string[] }>('/vault/pinned-commitments');
  return res.commitments ?? [];
}

/** Unpin a rule's commitment on-chain (wallet signs unpin_policy_commitment). */
export async function unpinCommitment(commitment: string): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>('/vault/unpin-commitment', { commitment });
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

// ── Public rules (named cleartext rules the vault checks directly) ─────────────

/**
 * A named cleartext PUBLIC rule: the full clause vocabulary the vault enforces on
 * every public (session) spend, in the clear (no proof). Each axis is independently
 * optional, 0 / empty means "no constraint on that axis". Identified by a 32-byte
 * rule id (hex). The private lane is keyless and never uses these; the public lane
 * trades zero-knowledge for hands-off speed, so the clauses live on-chain in plain
 * sight and the vault can roll their windows itself.
 */
export interface PublicRule {
  perPaymentMaxUsdc: number;
  perPaymentMinUsdc: number;
  rollingCapUsdc: number;
  rollingWindowSecs: number;
  velocityMax: number;
  velocityWindowSecs: number;
  allowlist: { addr: string; capUsdc: number }[];
  denylist: string[];
  denylistThresholdUsdc: number;
  calendarStart: number;
  calendarEnd: number;
}

/** Live usage for a public rule, so the UI can show used / remaining per axis. */
export interface PublicUsage {
  windowSpentUsdc: number;
  windowCount: number;
  lifetimeSpentUsdc: number;
  lifetimeCount: number;
  anchorR2: number;
  anchorR7: number;
}

// ── Global rules (AND-filter applied to every spend in a lane) ─────────────────

export interface GlobalsState {
  /** The global-private rule's commitment (hex), or null if none set. */
  privateCommitment: string | null;
  /** The public rule id (hex) marked global (AND-enforced on every spend), or null. */
  publicRuleId: string | null;
}

/** The user's current globals (one per lane). */
export async function getGlobals(): Promise<GlobalsState> {
  if (isDemo()) return { privateCommitment: null, publicRuleId: null };
  return apiFetch<GlobalsState>('/vault/globals');
}

async function signAndSubmitBuild(path: string, body: unknown): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>(path, body);
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

/**
 * A private rule's live on-chain usage: the rolling (R2) window spend and velocity
 * (R7) window count the vault re-derives at settlement, keyed by the rule's pinned
 * commitment. A rule never used reads back zeros. USDC for spend, a plain count for
 * velocity. (The clause thresholds stay private; only these running totals are
 * on-chain, so the owner can see used / remaining without revealing the rule.)
 */
export async function getCommitmentAccumulator(
  commitment: string,
): Promise<{ windowSpentUsdc: number; windowCount: number }> {
  if (isDemo()) return { windowSpentUsdc: 0, windowCount: 0 };
  const a = await apiFetch<{ runningSpend: string; priorCount: string }>(
    `/vault/accumulator/${commitment}`,
  );
  return {
    windowSpentUsdc: Number(a.runningSpend) / 10_000_000,
    windowCount: Number(a.priorCount),
  };
}

/** Read a named public rule (USDC / seconds) + its live usage, or nulls if unset. */
export async function getPublicRule(
  ruleId: string,
): Promise<{ rule: PublicRule | null; usage: PublicUsage | null }> {
  if (isDemo()) return { rule: null, usage: null };
  return apiFetch<{ rule: PublicRule | null; usage: PublicUsage | null }>(
    `/vault/public-rule/${ruleId}`,
  );
}

/** Store (or replace) a named cleartext public rule on-chain (wallet-signed). */
export function setPublicRule(ruleId: string, rule: PublicRule): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/public-rule/set', { ruleId, rule });
}
/** Remove a named public rule on-chain (wallet-signed). */
export function clearPublicRule(ruleId: string): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/public-rule/clear', { ruleId });
}

/** Make a PRIVATE rule the global-private (applies to every private spend; wallet-signed). */
export function setGlobalPrivate(commitment: string): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/global/private/set', { commitment });
}
/** Clear the global-private rule. */
export function clearGlobalPrivate(): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/global/private/clear', {});
}
/** Mark a public rule global (AND-enforced on every public spend; wallet-signed). */
export function setGlobalPublic(ruleId: string): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/global/public/set', { ruleId });
}
/** Clear the global-public rule. */
export function clearGlobalPublic(): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/global/public/clear', {});
}

export interface ManagedSessionScope {
  /** Total spend cap over the key's life (0 = unbounded by cap, bounded by a rule). */
  spendCapUsdc: number;
  spentUsdc: number;
  remainingUsdc: number;
  expiry: number;
  /** The public rule id (hex) this key runs under, or null if cap-only. */
  ruleId: string | null;
  serverHeld: boolean;
  paused: boolean;
  releaseCount: number;
}
export interface ManagedSession {
  sessionPublicKey: string | null;
  session: ManagedSessionScope | null;
}

/** The user's live Managed Session scope (server+public lane), or null if none. */
export async function getManagedSession(): Promise<ManagedSession> {
  if (isDemo()) return { sessionPublicKey: null, session: null };
  return apiFetch<ManagedSession>('/vault/session');
}

/**
 * Enable Managed Sessions (server + public lane): authorize the user's server-held
 * delegate as a bounded session key. A server key is scoped by just a total spend
 * cap + a hard expiry (no allowlist, no rule): it can pay any payee up to the cap
 * until it expires. The API builds register_session, the wallet signs ONCE, the API
 * submits. Thereafter the server spends hands-off within the scope and the vault
 * enforces it; pause, edit (extend/raise), or revoke at any time. This is the dapp's
 * public option (a browser key cannot sign hands-off).
 */
export async function enableManagedSession(
  spendCapUsdc: number,
  expiresInSeconds: number,
): Promise<{ txHash: string; sessionPublicKey: string; expiry: number }> {
  const built = await apiPost<BuildResp & { sessionPublicKey: string; expiry: number }>(
    '/vault/session/enable',
    { spendCapUsdc, expiresInSeconds },
  );
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  const res = await apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
  return { txHash: res.txHash, sessionPublicKey: built.sessionPublicKey, expiry: built.expiry };
}

/** Pause / unpause the Managed Session key on-chain (wallet-signed). Paused = no spend. */
export function pauseManagedSession(paused: boolean): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/session/pause', { paused });
}

/**
 * Edit the Managed Session on-chain (wallet-signed): extend the expiry and/or raise
 * the spend cap. Pass 0 to leave a field unchanged; the cap can never drop below what
 * has already been spent.
 */
export function updateManagedSession(
  newExpiresInSeconds: number,
  newSpendCapUsdc: number,
): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/session/update', { newExpiresInSeconds, newSpendCapUsdc });
}

/**
 * Hands-off public-lane spend via the Managed Session (the server signs; no wallet
 * prompt). Pass `ruleId` to enforce a specific public rule for THIS spend (selected
 * per task); the vault checks it on top of the session key's own cap + expiry, plus
 * any global public rule. Omit it for a cap-only spend.
 */
export async function managedSessionPay(
  payee: string,
  amount: number,
  ruleId?: string,
): Promise<{ txHash: string }> {
  return apiPost<{ txHash: string }>('/vault/session/pay', {
    payee,
    amount,
    ...(ruleId ? { ruleId } : {}),
  });
}

/** Revoke the Managed Session on-chain (wallet-signed); the key can spend nothing after. */
export async function revokeManagedSession(): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>('/vault/session/revoke', {});
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

// ── Self-custody agent keys (local session keys) ───────────────────────────────

/**
 * Authorize a SELF-CUSTODY agent key on-chain (wallet-signed, once): the owner blesses
 * an arbitrary public key, bound to a public rule and an optional spend cap / expiry.
 * The agent holds the key's secret and then spends hands-off (local mode). This is the
 * dapp-side one-time grant; pause / revoke it any time.
 */
export function registerAgentKey(
  sessionPublicKey: string,
  ruleId: string,
  spendCapUsdc?: number,
  expiresInSeconds?: number,
): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/agent-key/register', {
    sessionPublicKey,
    ruleId,
    ...(spendCapUsdc ? { spendCapUsdc } : {}),
    ...(expiresInSeconds ? { expiresInSeconds } : {}),
  });
}

/** Pause / unpause a self-custody agent key on-chain (wallet-signed). */
export function pauseAgentKey(sessionPublicKey: string, paused: boolean): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/agent-key/pause', { sessionPublicKey, paused });
}

/** Revoke a self-custody agent key on-chain (wallet-signed); it can spend nothing after. */
export function revokeAgentKey(sessionPublicKey: string): Promise<{ txHash: string }> {
  return signAndSubmitBuild('/vault/agent-key/revoke', { sessionPublicKey });
}

/** Read a specific agent key's live on-chain scope (cap/spent/rule/paused/...), or null. */
export async function getAgentKey(
  sessionPublicKey: string,
): Promise<{ sessionPublicKey: string; session: ManagedSessionScope | null }> {
  if (isDemo()) return { sessionPublicKey, session: null };
  return apiFetch(`/vault/agent-key/${sessionPublicKey}`);
}

/**
 * The user's own agent key (for the agent-key payment mode: paying external
 * x402/MPP services). The platform stores only the public key; the user's agent
 * holds the secret, so it stays non-custodial.
 */
export async function getAgentWallet(): Promise<{ publicKey: string | null }> {
  if (isDemo()) return { publicKey: null };
  return apiFetch<{ publicKey: string | null }>('/vault/agent-wallet');
}

export async function setAgentWallet(publicKey: string): Promise<{ publicKey: string }> {
  return apiPost<{ publicKey: string }>('/vault/agent-wallet', { publicKey });
}
