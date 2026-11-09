import { isDemo } from '../config';
import { apiFetch, apiPost, apiPatch } from './api';
import { demoEarnings, demoServices, demoJobs } from './demo';

export interface ProviderServiceItem {
  id: string;
  name: string;
  category: string | null;
  pricePerCall: number;
  status: string;
  rating: number;
  tier: string;
  trust: string;
  settlements: number;
  uniquePayers: number;
  disputes: number;
  disputesUpheld: number;
  // Whether the payout wallet can receive USDC (has a trustline). null = unknown.
  payoutReady: boolean | null;
  // Declared shape (manifest v2); null = sync/escrow.
  interaction: string | null;
  paymentModel: string | null;
  requiresFile: boolean;
  // System-managed endpoint health (auto-recovering); false = hidden from directory.
  healthy: boolean;
  lastHealthyAt: string | null;
}

export interface ProviderJob {
  id: string;
  service: string;
  from: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface ProviderEarnings {
  totalEarned: number;
  thisWeek: number;
  jobs: number;
  rating: number;
  recent: ProviderJob[];
}

export interface Payout {
  id: string;
  service: string;
  toAddress: string;
  from: string;
  amount: number;
  asset: string;
  status: string;
  method: string;
  txHash: string | null;
  createdAt: string;
}

export interface ProviderPayouts {
  items: Payout[];
  settledTotal: number;
  pendingTotal: number;
  count: number;
}

export interface ProviderMetrics {
  services: number;
  activeServices: number;
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  successRate: number; // percent (1 decimal)
  avgLatencyMs: number;
  disputes: number;
  disputesUpheld: number;
  disputeRate: number; // percent (1 decimal)
  uniquePayers: number;
}

interface ApiProviderService {
  id: string;
  name: string;
  category: string | null;
  pricePerCall: number;
  status: string;
  tier?: string;
  trust?: string;
  settlements?: number;
  uniquePayers?: number;
  disputes?: number;
  disputesUpheld?: number;
  payoutReady?: boolean | null;
  interaction?: string | null;
  paymentModel?: string | null;
  attachmentsIn?: { required?: boolean } | null;
  healthy?: boolean;
  lastHealthyAt?: string | null;
  reputation: { score: number } | null;
}

/** The provider's own services with their trust signals: demo in demo mode, else the API. */
export async function getProviderServices(): Promise<ProviderServiceItem[]> {
  if (isDemo()) {
    return demoServices.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      pricePerCall: s.pricePerCall,
      status: 'ACTIVE',
      rating: s.rating,
      tier: 'T2',
      trust: s.rating >= 4.5 ? 'trusted' : 'active',
      settlements: Math.round(s.rating * 7),
      uniquePayers: 3,
      disputes: 0,
      disputesUpheld: 0,
      payoutReady: true,
      interaction: null,
      paymentModel: null,
      requiresFile: false,
      healthy: true,
      lastHealthyAt: null,
    }));
  }
  const res = await apiFetch<{ items: ApiProviderService[] }>('/provider/services');
  return res.items.map(mapService);
}

export interface ProviderDispute {
  id: string;
  taskId: string;
  task: string | null;
  status: string;
  reason: string | null;
  resolution: string | null;
  providerResponse: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Disputes on tasks that use this provider's services (their inbox). */
export async function getProviderDisputes(): Promise<ProviderDispute[]> {
  if (isDemo()) return [];
  return apiFetch('/disputes/provider');
}

/** Post the provider's reply/evidence to a dispute. */
export async function respondToDispute(id: string, response: string): Promise<{ ok: boolean }> {
  if (isDemo()) return { ok: true };
  return apiPost(`/disputes/${id}/respond`, { response });
}

export interface RegisterServiceInput {
  name: string;
  description: string;
  category?: string;
  capabilities?: string[];
  pricingModel: 'X402' | 'MPP';
  pricePerCall: number;
  endpoint: string;
  stellarAddress: string;
  // Acceptance contract (optional): how delivery is judged before payment.
  tier?: 'T1' | 'T2' | 'T3';
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  verification?: { method: string; spec?: Record<string, unknown> };
  // Interaction/payment shape (manifest v2); absent = sync/escrow.
  interaction?: 'sync' | 'async' | 'human' | 'metered';
  paymentModel?: 'escrow' | 'x402' | 'mpp-session' | 'subscription';
  attachmentsIn?: { required?: boolean; accept?: string[]; maxSizeBytes?: number; maxCount?: number };
  // Usage requirements the buyer must satisfy before hiring (auth/install/key/info).
  prerequisites?: {
    kind: 'info' | 'apiKey' | 'install' | 'oauth';
    key: string;
    label: string;
    instructions: string;
    url?: string;
    secret?: boolean;
  }[];
}

/** Register a service (grants PROVIDER). Demo returns a local stand-in. */
export async function registerService(input: RegisterServiceInput): Promise<ProviderServiceItem> {
  if (isDemo()) {
    return {
      id: 'svc-' + Date.now(),
      name: input.name,
      category: input.category ?? null,
      pricePerCall: input.pricePerCall,
      status: 'ACTIVE',
      rating: 0,
      ...DEMO_TRUST,
      tier: input.tier ?? 'T2',
    };
  }
  return mapService(await apiPost<ApiProviderService>('/provider/services', input));
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  category?: string;
  capabilities?: string[];
  pricePerCall?: number;
  endpoint?: string;
  stellarAddress?: string;
}

const DEMO_TRUST = {
  tier: 'T2',
  trust: 'new',
  settlements: 0,
  uniquePayers: 0,
  disputes: 0,
  disputesUpheld: 0,
  payoutReady: true,
  interaction: null,
  paymentModel: null,
  requiresFile: false,
  healthy: true,
  lastHealthyAt: null,
};

function mapService(s: ApiProviderService): ProviderServiceItem {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    pricePerCall: s.pricePerCall,
    status: s.status,
    rating: s.reputation?.score ?? 0,
    tier: s.tier ?? 'T2',
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    uniquePayers: s.uniquePayers ?? 0,
    disputes: s.disputes ?? 0,
    disputesUpheld: s.disputesUpheld ?? 0,
    payoutReady: s.payoutReady ?? null,
    interaction: s.interaction ?? null,
    paymentModel: s.paymentModel ?? null,
    requiresFile: !!s.attachmentsIn?.required,
    healthy: s.healthy ?? true,
    lastHealthyAt: s.lastHealthyAt ?? null,
  };
}

/** Edit a service the caller owns. */
export async function updateService(
  id: string,
  input: UpdateServiceInput,
): Promise<ProviderServiceItem> {
  if (isDemo()) {
    const s = demoServices.find((d) => d.id === id) ?? demoServices[0];
    return {
      id,
      name: input.name ?? s.name,
      category: s.category,
      pricePerCall: input.pricePerCall ?? s.pricePerCall,
      status: 'ACTIVE',
      rating: s.rating,
      ...DEMO_TRUST,
    };
  }
  return mapService(await apiPatch<ApiProviderService>(`/provider/services/${id}`, input));
}

/** Pause or resume a service the caller owns. */
export async function setServiceStatus(id: string, active: boolean): Promise<ProviderServiceItem> {
  if (isDemo()) {
    const s = demoServices.find((d) => d.id === id) ?? demoServices[0];
    return {
      id,
      name: s.name,
      category: s.category,
      pricePerCall: s.pricePerCall,
      status: active ? 'ACTIVE' : 'INACTIVE',
      rating: s.rating,
      ...DEMO_TRUST,
    };
  }
  return mapService(
    await apiPost<ApiProviderService>(`/provider/services/${id}/status`, { active }),
  );
}

export interface ProviderStep {
  id: string;
  taskId: string;
  taskTitle: string;
  service: string | null;
  action: string;
  status: string;
  estimatedCost: number;
  latencyMs: number | null;
  createdAt: string;
}

/** Incoming work (task steps) routed to the provider's services. */
export async function getProviderJobs(): Promise<ProviderStep[]> {
  if (isDemo()) {
    return demoJobs.map((j) => ({
      id: j.id,
      taskId: j.id,
      taskTitle: j.service,
      service: j.service,
      action: 'Fulfil request',
      status: j.status.toUpperCase() === 'COMPLETED' ? 'RELEASED' : 'PENDING',
      estimatedCost: j.amountUsdc,
      latencyMs: null,
      createdAt: j.when,
    }));
  }
  const res = await apiFetch<{ items: ProviderStep[] }>('/provider/jobs');
  return res.items;
}

/** The provider's earnings and recent jobs: demo data in demo mode, live API otherwise. */
export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (isDemo()) {
    return {
      totalEarned: demoEarnings.totalUsdc,
      thisWeek: demoEarnings.thisWeekUsdc,
      jobs: demoEarnings.jobs,
      rating: demoEarnings.rating,
      recent: demoJobs.map((j) => ({
        id: j.id,
        service: j.service,
        from: j.buyer,
        amount: j.amountUsdc,
        status: j.status.toUpperCase(),
        createdAt: j.when,
      })),
    };
  }
  return apiFetch<ProviderEarnings>('/provider/earnings');
}

/** The provider's full payout ledger (for the payouts view + CSV export). */
export async function getProviderPayouts(): Promise<ProviderPayouts> {
  if (isDemo()) {
    const items: Payout[] = demoJobs.map((j) => ({
      id: j.id,
      service: j.service,
      toAddress: 'GPROVIDER000DEMO',
      from: j.buyer,
      amount: j.amountUsdc,
      asset: 'USDC',
      status: j.status.toUpperCase(),
      method: 'VAULT_RELEASE',
      txHash: null,
      createdAt: j.when,
    }));
    const settledTotal = items
      .filter((i) => i.status === 'CONFIRMED')
      .reduce((a, i) => a + i.amount, 0);
    return { items, settledTotal, pendingTotal: 0, count: items.length };
  }
  return apiFetch<ProviderPayouts>('/provider/payouts');
}

/** The provider's aggregate performance: demo stub in demo mode, live API otherwise. */
export async function getProviderMetrics(): Promise<ProviderMetrics> {
  if (isDemo()) {
    return {
      services: demoServices.length,
      activeServices: demoServices.length,
      totalJobs: demoEarnings.jobs,
      successfulJobs: demoEarnings.jobs,
      failedJobs: 0,
      successRate: 100,
      avgLatencyMs: 820,
      disputes: 0,
      disputesUpheld: 0,
      disputeRate: 0,
      uniquePayers: 3,
    };
  }
  return apiFetch<ProviderMetrics>('/provider/metrics');
}

/** Build a CSV string from payout rows (client-side; no server round-trip). */
export function payoutsToCsv(items: Payout[]): string {
  const header = ['Date', 'Service', 'From', 'Amount', 'Asset', 'Status', 'Method', 'TxHash'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = items.map((i) =>
    [
      new Date(i.createdAt).toISOString(),
      i.service,
      i.from,
      i.amount.toFixed(7),
      i.asset,
      i.status,
      i.method,
      i.txHash ?? '',
    ]
      .map((c) => esc(String(c)))
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
