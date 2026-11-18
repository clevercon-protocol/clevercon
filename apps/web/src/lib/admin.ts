import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';
import { demoPlatform } from './demo';

export interface AdminStats {
  users: number;
  activeServices: number;
  totalServices: number;
  tasks: number;
  paymentsCount: number;
  paymentsVolumeUsdc: number;
  tvlUsdc: number;
  lockedUsdc: number;
}

export interface AdminUser {
  id: string;
  createdAt: string;
  roles: string[];
  wallet: string | null;
  displayName?: string | null;
  handle?: string | null;
  verified?: boolean;
  services: number;
  tasks: number;
  apiKeys: number;
}

export interface AdminOrg {
  id: string;
  handle: string;
  name: string;
  verified: boolean;
  services: number;
  members: number;
  createdAt: string;
}

export async function getAdminStats(): Promise<AdminStats> {
  if (isDemo()) {
    return {
      users: demoPlatform.users,
      activeServices: demoPlatform.activeServices,
      totalServices: demoPlatform.activeServices,
      tasks: 0,
      paymentsCount: 0,
      paymentsVolumeUsdc: 0,
      tvlUsdc: demoPlatform.tvlUsdc,
      lockedUsdc: 0,
    };
  }
  return apiFetch<AdminStats>('/admin/stats');
}

export interface ActivationStep {
  key: string;
  label: string;
  count: number;
}
export interface Activation {
  total: number;
  steps: ActivationStep[];
}

/** The activation funnel: how many users reached each step of the core path. */
export async function getActivation(): Promise<Activation> {
  if (isDemo()) {
    return {
      total: demoPlatform.users,
      steps: [
        { key: 'connected', label: 'Connected a wallet', count: demoPlatform.users },
        { key: 'funded', label: 'Funded a vault', count: Math.round(demoPlatform.users * 0.6) },
        {
          key: 'policy',
          label: 'Set a spending policy',
          count: Math.round(demoPlatform.users * 0.5),
        },
        { key: 'agent', label: 'Created an API key', count: Math.round(demoPlatform.users * 0.35) },
        { key: 'hired', label: 'Created a task', count: Math.round(demoPlatform.users * 0.3) },
        {
          key: 'paid',
          label: 'Made a bounded payment',
          count: Math.round(demoPlatform.users * 0.2),
        },
      ],
    };
  }
  return apiFetch<Activation>('/admin/activation');
}

export interface MarketplaceAnalytics {
  activeServices: number;
  totalServices: number;
  settledJobs: number;
  gmvUsdc: number;
  byTier: { tier: string; services: number }[];
  byCategory: { category: string; services: number }[];
  topServices: { name: string; tier: string; settlements: number; score: number }[];
}

/** Marketplace health: directory shape + real settled-job traction. */
export async function getMarketplaceAnalytics(): Promise<MarketplaceAnalytics> {
  if (isDemo()) {
    return {
      activeServices: demoPlatform.activeServices,
      totalServices: demoPlatform.activeServices,
      settledJobs: 0,
      gmvUsdc: 0,
      byTier: [],
      byCategory: [],
      topServices: [],
    };
  }
  return apiFetch<MarketplaceAnalytics>('/admin/marketplace');
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ items: AdminUser[] }>('/admin/users');
  return res.items;
}

export async function setUserRole(
  userId: string,
  role: string,
  grant: boolean,
): Promise<{ userId: string; roles: string[] }> {
  return apiPost<{ userId: string; roles: string[] }>(`/admin/users/${userId}/roles`, {
    role,
    grant,
  });
}

export async function getAdminOrgs(): Promise<AdminOrg[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ items: AdminOrg[] }>('/admin/orgs');
  return res.items;
}

/** Grant or revoke an org's verified tick (its services inherit it). */
export async function verifyOrg(
  id: string,
  verified: boolean,
): Promise<{ id: string; verified: boolean }> {
  return apiPost<{ id: string; verified: boolean }>(`/admin/orgs/${id}/verify`, { verified });
}

/** Grant or revoke an individual provider's verified tick. */
export async function verifyUser(
  id: string,
  verified: boolean,
): Promise<{ id: string; verified: boolean }> {
  return apiPost<{ id: string; verified: boolean }>(`/admin/users/${id}/verify`, { verified });
}

export interface AdminServiceItem {
  id: string;
  agentId: string;
  name: string;
  category: string | null;
  status: string;
  pricePerCall: number;
  score: number;
  totalJobs: number;
}

export async function getAdminServices(): Promise<AdminServiceItem[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ items: AdminServiceItem[] }>('/admin/services');
  return res.items;
}

export async function moderateService(
  id: string,
  active: boolean,
): Promise<{ id: string; status: string }> {
  return apiPost<{ id: string; status: string }>(`/admin/services/${id}/moderate`, { active });
}

export interface AdminDispute {
  id: string;
  taskId: string;
  taskTitle: string;
  budget: number;
  raisedBy: string;
  status: string;
  reason: string | null;
  resolution: string | null;
  refundToUser: number | null;
  payoutToProvider: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export async function getDisputes(): Promise<AdminDispute[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ items: AdminDispute[] }>('/admin/disputes');
  return res.items;
}

/**
 * Settle a dispute on-chain: signs resolve_dispute with the platform resolver key
 * and splits the locked remainder (the vault enforces refund + payout == plan_cost
 * - spent), then records the outcome + reputation. Needs the resolver configured
 * (DISPUTE_RESOLVER_SECRET + set_dispute_resolver); otherwise the API returns a
 * clear "not configured" error.
 */
export async function resolveDispute(
  id: string,
  body: {
    refundToUser: number;
    payoutToProvider: number;
    upheld: boolean;
    resolution: string;
  },
): Promise<{ ok: boolean; txHash?: string }> {
  return apiPost<{ ok: boolean; txHash?: string }>(`/disputes/${id}/resolve`, body);
}

export interface FeeConfig {
  enabled: boolean;
  bps: number;
  recipient: string | null;
  accruedUsdc: number;
}

export async function getFees(): Promise<FeeConfig> {
  if (isDemo()) return { enabled: false, bps: 30, recipient: null, accruedUsdc: 0 };
  return apiFetch<FeeConfig>('/admin/fees');
}

export async function setFee(bps: number, recipient?: string): Promise<FeeConfig> {
  return apiPost<FeeConfig>('/admin/fees', { bps, ...(recipient ? { recipient } : {}) });
}

/** Claim accrued protocol fees to the configured recipient. */
export async function claimFees(): Promise<FeeConfig & { txHash: string; claimedUsdc: number }> {
  return apiPost<FeeConfig & { txHash: string; claimedUsdc: number }>('/admin/fees/claim', {});
}
