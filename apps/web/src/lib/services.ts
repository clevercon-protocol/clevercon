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

export interface ServiceDetail extends Service {
  capabilities: string[];
  pricingModel: string;
  currency: string;
  endpoint: string;
  status: string;
  totalJobs: number;
  avgLatencyMs: number | null;
}

interface ApiServiceDetail extends ApiService {
  capabilities: string[];
  currency: string;
  endpoint: string;
  status: string;
  reputation: { score: number; totalJobs: number; avgLatencyMs: number } | null;
}

/** One service's detail: demo data in demo mode, the live API otherwise. */
export async function getService(id: string): Promise<ServiceDetail> {
  if (isDemo()) {
    const d = demoServices.find((s) => s.id === id) ?? demoServices[0];
    return {
      id,
      name: d.name,
      description: d.description,
      category: d.category,
      pricePerCall: d.pricePerCall,
      rating: d.rating,
      provider: d.provider,
      capabilities: ['demo-capability'],
      pricingModel: 'X402',
      currency: 'USDC',
      endpoint: 'https://demo.example.com',
      status: 'ACTIVE',
      totalJobs: 42,
      avgLatencyMs: 780,
    };
  }
  const s = await apiFetch<ApiServiceDetail>(`/services/${id}`);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    pricePerCall: s.pricePerCall,
    rating: s.reputation?.score ?? 0,
    provider: s.pricingModel === 'MPP' ? 'streaming' : 'per-call',
    capabilities: s.capabilities ?? [],
    pricingModel: s.pricingModel,
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    totalJobs: s.reputation?.totalJobs ?? 0,
    avgLatencyMs: s.reputation?.avgLatencyMs ?? null,
  };
}
