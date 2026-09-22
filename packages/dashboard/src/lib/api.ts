import { API_BASE, BACKEND_ENABLED, BackendOfflineError, HORIZON_URL, NETWORK_PASSPHRASE, USDC_ISSUER } from './config';
import { Horizon, TransactionBuilder, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk';
import { MOCK_AGENTS } from './mock-agents';

const BASE = API_BASE; // '' = same origin (orchestrator serves API + dashboard)

export async function submitTask(task: string, budget: number, userAddress?: string) {
  if (!BACKEND_ENABLED) throw new BackendOfflineError();
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, budget, user_address: userAddress }),
  });
  return res.json();
}

export async function fetchAgents() {
  if (!BACKEND_ENABLED) return MOCK_AGENTS;
  const res = await fetch(`${BASE}/api/agents`);
  const data = await res.json();
  return data.agents ?? [];
}

export async function fetchWallets() {
  const res = await fetch(`${BASE}/api/wallets`);
  return res.json();
}

export async function approveTask(task_id: string) {
  const res = await fetch(`${BASE}/api/tasks/${task_id}/approve`, { method: 'POST' });
  return res.json();
}

export async function rejectTask(task_id: string) {
  const res = await fetch(`${BASE}/api/tasks/${task_id}/reject`, { method: 'POST' });
  return res.json();
}

export async function fetchUsdcTrustlineXdr(userAddress: string): Promise<string> {
  // Built client-side: a classic changeTrust(USDC) transaction, no backend.
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(userAddress);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_ISSUER) }))
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export async function submitUsdcTrustlineXdr(signedXdr: string): Promise<string> {
  // Submitted client-side via Horizon, no backend.
  const horizon = new Horizon.Server(HORIZON_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}

export async function registerAgent(manifest: any) {
  const res = await fetch(`${BASE}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  return res.json();
}

// U7: Activity log
export async function fetchActivity(userAddress: string) {
  if (!BACKEND_ENABLED) return [];
  const res = await fetch(`${BASE}/api/activity/${userAddress}`);
  const data = await res.json();
  return data.events ?? [];
}

// U7: Marketplace pulse
export async function fetchPulse() {
  if (!BACKEND_ENABLED) return {};
  const res = await fetch(`${BASE}/api/stats/pulse`);
  return res.json();
}

// U7: Cancel task XDR (for user to sign in Freighter)
export async function fetchCancelTaskXdr(userAddress: string, vaultTaskId: number): Promise<string> {
  const res = await fetch(`${BASE}/api/vault/cancel-task-xdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress, vault_task_id: vaultTaskId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build cancel XDR');
  return data.xdr;
}

// Rename an agent (display name only) — requester_address must match agent's stellar_address
export async function renameAgent(agent_id: string, name: string, requester_address: string) {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(agent_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, requester_address }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Rename failed');
  return data;
}

// Rename the user's orchestrator
export async function renameOrchestrator(user_address: string, name: string) {
  const res = await fetch('/api/orchestrators/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Rename failed');
  return data;
}

// Delete an agent from registry — requester_address must match agent's stellar_address
export async function deleteAgent(agent_id: string, requester_address: string) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agent_id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_address }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? 'Delete failed');
  return true;
}

// Vault ledger — real vault transaction history
export async function fetchVaultLedger(userAddress: string) {
  if (!BACKEND_ENABLED) return [];
  const res = await fetch(`${BASE}/api/vault/ledger/${encodeURIComponent(userAddress)}`);
  const data = await res.json();
  return data.entries ?? [];
}

// Task history — persisted results for History tab
export async function fetchTaskHistory(userAddress: string) {
  if (!BACKEND_ENABLED) return [];
  const res = await fetch(`${BASE}/api/tasks/history/${encodeURIComponent(userAddress)}`);
  const data = await res.json();
  return data.results ?? [];
}

export async function deleteTaskHistory(taskId: string, userAddress: string): Promise<boolean> {
  const res = await fetch(
    `${BASE}/api/tasks/history/${encodeURIComponent(taskId)}?user_address=${encodeURIComponent(userAddress)}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

// U7: Force-complete a stale task (server-signed)
export async function forceCompleteVaultTask(userAddress: string, vaultTaskId: number) {
  const res = await fetch(`${BASE}/api/vault/force-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress, vault_task_id: vaultTaskId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Force complete failed');
  return data;
}


// Service health checks (ServiceHealth component). Timeout/cancellation is
// the caller's responsibility via the supplied AbortSignal, so this file
// doesn't own polling policy.
export interface AgentRecord {
  agent_id?: string;
  name?: string;
  status?: string;
}

export async function fetchOrchestratorHealth(signal: AbortSignal): Promise<boolean> {
  if (!BACKEND_ENABLED) return false;
  try {
    const res = await fetch(`${BASE}/health`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchRegistryHealth(
  signal: AbortSignal,
): Promise<{ ok: boolean; agents: AgentRecord[] }> {
  if (!BACKEND_ENABLED) return { ok: false, agents: [] };
  try {
    const res = await fetch(`${BASE}/api/agents`, { signal });
    if (!res.ok) return { ok: false, agents: [] };
    const data: unknown = await res.json();
    const rawAgents = (data as { agents?: unknown })?.agents;
    const agents: AgentRecord[] = Array.isArray(rawAgents)
      ? rawAgents.filter((a): a is AgentRecord => a !== null && typeof a === 'object')
      : [];
    return { ok: true, agents };
  } catch {
    return { ok: false, agents: [] };
  }
}