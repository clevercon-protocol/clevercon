import { isDemo } from '../config';
import { apiFetch } from './api';
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
