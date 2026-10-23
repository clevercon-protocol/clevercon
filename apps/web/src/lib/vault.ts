import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';
import { signTransaction } from './wallet';
import { useSession } from '../store/session';
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
}

/** Deposit availability + the deployed contract address (empty in demo/unconfigured). */
export async function getVaultStatus(): Promise<VaultStatus> {
  if (isDemo()) return { depositsEnabled: false, contractAddress: '' };
  return apiFetch<VaultStatus>('/vault/status');
}

interface BuildResp {
  xdr: string;
  networkPassphrase: string;
}

interface ChallengeResp {
  transaction: string;
  networkPassphrase: string;
}

/**
 * Obtain a fresh step-up wallet signature authorizing a money action. The server
 * requires this (x-stepup header) on deposit/withdraw so a leaked access token
 * alone cannot move funds: get a SEP-10 challenge for the connected wallet and
 * sign it. Single-use and short-lived server-side.
 */
async function stepUpSignature(): Promise<string> {
  const address = useSession.getState().session?.address;
  if (!address) throw new Error('Connect a wallet first');
  const challenge = await apiPost<ChallengeResp>('/auth/challenge', { address });
  return signTransaction(challenge.transaction, challenge.networkPassphrase);
}

/**
 * Deposit into (or withdraw from) the vault: prove wallet control with a step-up
 * signature, the API builds an unsigned XDR, the wallet signs it, then the API
 * submits it. On-chain is the source of truth, so the mirrored balance updates
 * once the indexer catches the event.
 */
async function signAndSubmit(path: '/vault/deposit' | '/vault/withdraw', amountUsdc: number) {
  const stepUp = await stepUpSignature();
  const built = await apiFetch<BuildResp>(path, {
    method: 'POST',
    body: JSON.stringify({ amountUsdc }),
    headers: { 'x-stepup': stepUp },
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

export interface ManagedSessionScope {
  budgetRemainingUsdc: number;
  expiry: number;
  allowlist: string[];
  spentUsdc: number;
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
 * delegate as a bounded session key (budget + payee allowlist + hard expiry). The
 * API builds register_session, the wallet signs ONCE, the API submits. Thereafter
 * the server can spend hands-off within the scope and the vault enforces it; revoke
 * instantly with `revokeManagedSession`. This is the dapp's public option (a browser
 * key cannot sign hands-off), replacing Autopay with on-chain limits.
 */
export async function enableManagedSession(
  budgetUsdc: number,
  allowlist: string[],
  expiresInSeconds: number,
): Promise<{ txHash: string; sessionPublicKey: string; expiry: number }> {
  const built = await apiPost<BuildResp & { sessionPublicKey: string; expiry: number }>(
    '/vault/session/enable',
    { budgetUsdc, allowlist, expiresInSeconds },
  );
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  const res = await apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
  return { txHash: res.txHash, sessionPublicKey: built.sessionPublicKey, expiry: built.expiry };
}

/** Hands-off public-lane spend via the Managed Session (the server signs; no wallet prompt). */
export async function managedSessionPay(
  payee: string,
  amount: number,
): Promise<{ txHash: string }> {
  return apiPost<{ txHash: string }>('/vault/session/pay', { payee, amount });
}

/** Revoke the Managed Session on-chain (wallet-signed); the key can spend nothing after. */
export async function revokeManagedSession(): Promise<{ txHash: string }> {
  const built = await apiPost<BuildResp>('/vault/session/revoke', {});
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
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
