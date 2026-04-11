const BASE = '';  // Same origin — orchestrator serves both API and dashboard

export async function submitTask(task: string, budget: number, userAddress?: string) {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, budget, user_address: userAddress }),
  });
  return res.json();
}

export async function fetchAgents() {
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
  const res = await fetch(`${BASE}/api/orchestrators/usdc-trustline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build XDR');
  return data.xdr;
}

export async function submitUsdcTrustlineXdr(signedXdr: string): Promise<string> {
  const res = await fetch(`${BASE}/api/orchestrators/usdc-trustline/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed_xdr: signedXdr }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to submit');
  return data.tx_hash;
}

export async function registerAgent(manifest: any) {
  const res = await fetch(`http://localhost:4000/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  return res.json();
}

// U7: Activity log
export async function fetchActivity(userAddress: string) {
  const res = await fetch(`${BASE}/api/activity/${userAddress}`);
  const data = await res.json();
  return data.events ?? [];
}

// U7: Marketplace pulse
export async function fetchPulse() {
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
  const res = await fetch(`http://localhost:4000/agents/${encodeURIComponent(agent_id)}`, {
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
  const res = await fetch(`${BASE}/api/vault/ledger/${encodeURIComponent(userAddress)}`);
  const data = await res.json();
  return data.entries ?? [];
}

// Task history — persisted results for History tab
export async function fetchTaskHistory(userAddress: string) {
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
