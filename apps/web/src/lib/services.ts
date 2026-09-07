import { isDemo } from '../config';
import { apiFetch } from './api';
import { demoServices } from './demo';

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  rating: number;
  provider: string;
}

interface ApiService {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  pricingModel: string;
  reputation: { score: number } | null;
}

/** Marketplace services: demo data in demo mode, the live API otherwise. */
export async function getServices(): Promise<Service[]> {
  if (isDemo()) {
    return demoServices.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      category: d.category,
      pricePerCall: d.pricePerCall,
      rating: d.rating,
      provider: d.provider,
    }));
  }
  const res = await apiFetch<{ items: ApiService[] }>('/services');
  return res.items.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    pricePerCall: s.pricePerCall,
    rating: s.reputation?.score ?? 0,
    provider: s.pricingModel === 'MPP' ? 'streaming' : 'per-call',
  }));
}
