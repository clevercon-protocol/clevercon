import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export interface PolicyRules {
  perPaymentCeilingUsdc?: number;
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  allowlist?: string[];
  denylist?: string[];
  denylistThresholdUsdc?: number;
}

export interface Policy {
  id: string;
  commitment: string;
  isPrivate: boolean;
  rules: PolicyRules | null;
  /** Private rules: wallet-encrypted {clauses, salt} backup (ciphertext) for cross-device re-proving. */
  encryptedBackup?: string | null;
  /** Lifecycle + shared-model fields (present from the live API; optional in demo). */
  name?: string | null;
  form?: 'private' | 'public';
  status?: 'active' | 'archived';
  version?: number;
  supersedes?: string | null;
  global?: boolean;
  createdAt: string;
}

const demoPolicies: Policy[] = [
  {
    id: 'pol-demo-1',
    commitment: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    isPrivate: false,
    rules: { perPaymentCeilingUsdc: 0.5, rollingCapUsdc: 20, rollingWindowSecs: 86400 },
    createdAt: '2026-09-06T12:00:00Z',
  },
];

/** The session's spending policies: demo data in demo mode, the live API otherwise. */
export async function getPolicies(): Promise<Policy[]> {
  if (isDemo()) return demoPolicies;
  const res = await apiFetch<{ items: Policy[] }>('/policies');
  return res.items;
}

/** Optional lifecycle fields when creating/editing a policy (Phase A5). */
export interface CreatePolicyOpts {
  name?: string;
  form?: 'private' | 'public';
  global?: boolean;
  /** When editing: the id of the policy this new version supersedes. */
  supersedes?: string;
  /** Private rules: the client's canonical pp/2 commitment (32-byte hex) the owner pins. */
  commitment?: string;
  /** Private rules: opaque wallet-encrypted {clauses, salt} backup the server stores but cannot read. */
  encryptedBackup?: string;
}

/**
 * Create a policy. Private mode stores only the commitment (the plaintext rule
 * is not persisted server-side); transparent/public mode stores the rule too.
 * Passing `supersedes` records an edit as a new version that replaces the old.
 */
export async function createPolicy(
  rules: PolicyRules,
  isPrivate: boolean,
  opts: CreatePolicyOpts = {},
): Promise<Policy> {
  if (isDemo()) {
    return {
      id: 'pol-' + Date.now(),
      commitment: Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join(''),
      isPrivate,
      // Private policies do not keep the plaintext rule, mirroring the API.
      rules: isPrivate ? null : rules,
      name: opts.name ?? null,
      form: opts.form ?? (isPrivate ? 'private' : 'public'),
      status: 'active',
      version: 1,
      global: opts.global ?? false,
      createdAt: new Date().toISOString(),
    };
  }
  return apiPost<Policy>('/policies', { rules, isPrivate, ...opts });
}

/** Archive a saved limit: hidden from pickers, kept for audit. */
export async function archivePolicy(id: string): Promise<Policy> {
  if (isDemo()) return { ...demoPolicies[0], id, status: 'archived' };
  return apiPost<Policy>(`/policies/${encodeURIComponent(id)}/archive`, {});
}

/** Permanently delete a saved rule (removes the dapp's copy; the on-chain commitment is immutable). */
export async function deletePolicy(id: string): Promise<{ ok: true }> {
  if (isDemo()) return { ok: true };
  return apiFetch<{ ok: true }>(`/policies/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface ProofStatus {
  id: string;
  status: 'REQUESTED' | 'GENERATING' | 'READY' | 'VERIFIED' | 'REJECTED' | 'FAILED';
  hasProof: boolean;
  nullifier: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request a binding proof authorising a release (payee + amount) under a policy.
 * The worker generates it asynchronously; poll getProofStatus (or listen for
 * `proof.updated`) until it is READY.
 */
export async function requestProof(
  policyId: string,
  payeeAddress: string,
  amountUsdc: number,
): Promise<{ proofId: string; status: string }> {
  if (isDemo()) return { proofId: 'proof-' + Date.now(), status: 'REQUESTED' };
  return apiPost<{ proofId: string; status: string }>(`/policies/${policyId}/proofs`, {
    payeeAddress,
    amountUsdc,
  });
}

/** Poll a proof's status. */
export async function getProofStatus(proofId: string): Promise<ProofStatus> {
  if (isDemo()) {
    return {
      id: proofId,
      status: 'READY',
      hasProof: true,
      nullifier: 'demo'.padEnd(64, '0'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return apiFetch<ProofStatus>(`/policies/proofs/${proofId}`);
}
