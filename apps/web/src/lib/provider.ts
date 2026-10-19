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
    }));
  }
  const res = await apiFetch<{ items: ApiProviderService[] }>('/provider/services');
  return res.items.map((s) => ({
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
  }));
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
