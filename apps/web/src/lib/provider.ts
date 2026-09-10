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
  reputation: { score: number } | null;
}

/** The provider's own services: demo data in demo mode, the live API otherwise. */
export async function getProviderServices(): Promise<ProviderServiceItem[]> {
  if (isDemo()) {
    return demoServices.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      pricePerCall: s.pricePerCall,
      status: 'ACTIVE',
      rating: s.rating,
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
  }));
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
    };
  }
  const s = await apiPost<ApiProviderService>('/provider/services', input);
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    pricePerCall: s.pricePerCall,
    status: s.status,
    rating: s.reputation?.score ?? 0,
  };
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

function mapService(s: ApiProviderService): ProviderServiceItem {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    pricePerCall: s.pricePerCall,
    status: s.status,
    rating: s.reputation?.score ?? 0,
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
    };
  }
  return mapService(
    await apiPost<ApiProviderService>(`/provider/services/${id}/status`, { active }),
  );
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
