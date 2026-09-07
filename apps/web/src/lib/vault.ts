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

/** Whether on-chain deposit/withdraw is available (false in demo/unconfigured). */
export async function getVaultStatus(): Promise<{ depositsEnabled: boolean }> {
  if (isDemo()) return { depositsEnabled: false };
  return apiFetch<{ depositsEnabled: boolean }>('/vault/status');
}

interface BuildResp {
  xdr: string;
  networkPassphrase: string;
}

/**
 * Deposit into (or withdraw from) the vault: the API builds an unsigned XDR, the
 * wallet signs it, then the API submits it. On-chain is the source of truth, so
 * the mirrored balance updates once the indexer catches the event.
 */
async function signAndSubmit(path: '/vault/deposit' | '/vault/withdraw', amountUsdc: number) {
  const built = await apiPost<BuildResp>(path, { amountUsdc });
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  return apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
}

export function depositToVault(amountUsdc: number): Promise<{ txHash: string }> {
  return signAndSubmit('/vault/deposit', amountUsdc);
}

export function withdrawFromVault(amountUsdc: number): Promise<{ txHash: string }> {
  return signAndSubmit('/vault/withdraw', amountUsdc);
}
