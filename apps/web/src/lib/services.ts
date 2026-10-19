import { isDemo } from '../config';
import { apiFetch } from './api';
import { demoServices } from './demo';

/** Settlement-gated trust tier, earned by real on-chain settled jobs. */
export type TrustTier = 'new' | 'active' | 'trusted';

/** Verification tier: how a service's delivery is judged before it is paid. */
export type Tier = 'T1' | 'T2' | 'T3';

export interface Verification {
  method: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  rating: number;
  provider: string;
  /** Trust earned by real on-chain settlements (anti-spam, our discovery primitive). */
  trust: TrustTier;
  /** Count of real settled jobs behind the trust tier. */
  settlements: number;
  /** Curated: a service we vouch for. */
  verified: boolean;
  /** How the service charges: x402 one-shot or MPP metered. */
  pricingModel: string;
  /** Verification tier (T1 trustless / T2 attestable / T3 human). */
  tier: Tier;
  /** How delivery is verified, when declared. */
  verification: Verification | null;
}

interface ApiService {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  pricingModel: string;
  trust?: TrustTier;
  settlements?: number;
  verified?: boolean;
  tier?: Tier;
  verification?: Verification | null;
  reputation: { score: number } | null;
}

/** Short label for a verification tier. */
export function tierLabel(tier: Tier): string {
  return tier === 'T1' ? 'Verifiable' : tier === 'T2' ? 'Attestable' : 'Human';
}

/** Plain-language explanation of how a service's delivery is judged before payment. */
export function verificationBlurb(tier: Tier, v: Verification | null): string {
  if (tier === 'T1') {
    switch (v?.method) {
      case 'onchain':
        return 'Trustless: the result is re-derived and checked on-chain before you pay.';
      case 'content-hash':
        return 'Trustless: the result must match the requested content hash before you pay.';
      case 'signature':
        return 'Signed by the provider and verified before you pay.';
      case 'witness':
        return 'Trustless: the result carries a proof your agent re-checks before you pay.';
      default:
        return 'Trustless: the result is verified before you pay.';
    }
  }
  if (tier === 'T2')
    return 'Attestable: checked against the declared result shape, with a dispute window if contested.';
  return 'Human: released on your approval or a milestone.';
}

export type ServiceSort = 'trust' | 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface ServiceQuery {
  q?: string;
  category?: string;
  tier?: Tier | 'All';
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

export interface ServicePage {
  items: Service[];
  total: number;
}

function mapApiService(s: ApiService): Service {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    pricePerCall: s.pricePerCall,
    rating: s.reputation?.score ?? 0,
    provider: s.pricingModel === 'MPP' ? 'streaming' : 'per-call',
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    verified: !!s.verified,
    pricingModel: s.pricingModel,
    tier: s.tier ?? 'T2',
    verification: s.verification ?? null,
  };
}

function sortClient(list: Service[], sort: ServiceSort): Service[] {
  const sorted = [...list];
  if (sort === 'trust') sorted.sort((a, b) => b.settlements - a.settlements || b.rating - a.rating);
  else if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
  else if (sort === 'price_asc') sorted.sort((a, b) => a.pricePerCall - b.pricePerCall);
  else if (sort === 'price_desc') sorted.sort((a, b) => b.pricePerCall - a.pricePerCall);
  // 'recent' keeps the source order.
  return sorted;
}

/**
 * Marketplace services with server-side search/filter/sort/pagination (so paging
 * is correct against the full set). Demo mode applies the same operations to the
 * demo list client-side so the UI behaves identically.
 */
export async function getServices(params: ServiceQuery = {}): Promise<ServicePage> {
  const { q = '', category, tier, sort = 'trust', limit = 12, offset = 0 } = params;
  if (isDemo()) {
    let list: Service[] = demoServices.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      category: d.category,
      pricePerCall: d.pricePerCall,
      rating: d.rating,
      provider: d.provider,
      trust: d.rating >= 4.5 ? 'trusted' : d.rating >= 3 ? 'active' : 'new',
      settlements: Math.round(d.rating * 7),
      verified: d.rating >= 4.7,
      pricingModel: d.provider === 'streaming' ? 'MPP' : 'X402',
      tier: d.rating >= 4.7 ? 'T1' : 'T2',
      verification: d.rating >= 4.7 ? { method: 'onchain' } : { method: 'attest' },
    }));
    if (category && category !== 'All') list = list.filter((s) => s.category === category);
    if (tier && tier !== 'All') list = list.filter((s) => s.tier === tier);
    if (q) {
      const t = q.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(t) || s.description.toLowerCase().includes(t),
      );
    }
    list = sortClient(list, sort);
    return { items: list.slice(offset, offset + limit), total: list.length };
  }
  const usp = new URLSearchParams();
  if (q) usp.set('q', q);
  if (category && category !== 'All') usp.set('category', category);
  if (tier && tier !== 'All') usp.set('tier', tier);
  usp.set('sort', sort);
  usp.set('limit', String(limit));
  usp.set('offset', String(offset));
  const res = await apiFetch<{ items: ApiService[]; total: number }>(`/services?${usp.toString()}`);
  return { items: res.items.map(mapApiService), total: res.total };
}

export interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string }>;
}

export interface ServiceDetail extends Service {
  capabilities: string[];
  pricingModel: string;
  currency: string;
  endpoint: string;
  status: string;
  totalJobs: number;
  avgLatencyMs: number | null;
  // What a job takes, so the hire form can collect it.
  inputSchema: JsonSchema | null;
}

interface ApiServiceDetail extends ApiService {
  capabilities: string[];
  currency: string;
  endpoint: string;
  status: string;
  inputSchema?: JsonSchema | null;
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
      trust: 'trusted',
      settlements: 30,
      verified: true,
      tier: 'T1',
      verification: { method: 'onchain' },
      capabilities: ['demo-capability'],
      pricingModel: 'X402',
      currency: 'USDC',
      endpoint: 'https://demo.example.com',
      status: 'ACTIVE',
      totalJobs: 42,
      avgLatencyMs: 780,
      inputSchema: null,
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
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    verified: !!s.verified,
    tier: s.tier ?? 'T2',
    verification: s.verification ?? null,
    capabilities: s.capabilities ?? [],
    pricingModel: s.pricingModel,
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    totalJobs: s.reputation?.totalJobs ?? 0,
    avgLatencyMs: s.reputation?.avgLatencyMs ?? null,
    inputSchema: s.inputSchema ?? null,
  };
}

/** The public protocol fee in basis points (0 = none). For disclosure in the UI. */
export async function getPlatformFeeBps(): Promise<number> {
  if (isDemo()) return 0;
  try {
    const { bps } = await apiFetch<{ bps: number }>('/services/fee');
    return bps;
  } catch {
    return 0;
  }
}
