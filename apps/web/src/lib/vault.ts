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
