/**
 * Frontend CleverVault client.
 * Calls backend API endpoints which proxy Soroban RPC calls.
 * All USDC amounts are in decimal (e.g. 1.5 = $1.50).
 */

const BASE = '';

export interface VaultAccount {
  balance: number;
  available: number;
  locked: number;
  total_deposited: number;
  total_spent: number;
  active_tasks_count: number;
}

export async function fetchVaultAccount(userAddress: string): Promise<VaultAccount> {
  const res = await fetch(`${BASE}/api/vault/account/${userAddress}`);
  if (!res.ok) {
    // 503 = transient RPC error — caller should keep last known balance
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function buildDepositXdr(userAddress: string, amount: number): Promise<string> {
  const res = await fetch(`${BASE}/api/vault/deposit-xdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build deposit XDR');
  return data.xdr;
}

export async function buildWithdrawXdr(userAddress: string, amount: number): Promise<string> {
  const res = await fetch(`${BASE}/api/vault/withdraw-xdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build withdraw XDR');
  return data.xdr;
}

export async function submitVaultXdr(
  signedXdr: string,
  meta?: { user_address: string; tx_type: 'deposit' | 'withdrawal'; amount: number },
): Promise<string> {
  const res = await fetch(`${BASE}/api/vault/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed_xdr: signedXdr, ...meta }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Transaction failed');
  return data.tx_hash;
}

export async function buildCancelTaskXdr(userAddress: string, vaultTaskId: number): Promise<string> {
  const res = await fetch(`${BASE}/api/vault/cancel-task-xdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress, vault_task_id: vaultTaskId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build cancel XDR');
  return data.xdr;
}
