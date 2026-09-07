import { isDemo } from '../config';
import { apiFetch } from './api';
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
