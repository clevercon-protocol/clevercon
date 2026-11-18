import type { Tier, VerificationSpec, JsonSchema } from './marketplace.js';

// Marketplace discovery for autonomous agents: a thin, dependency-free read
// client over CleverCon's public /services API. An agent uses it to FIND a
// service, inspect its acceptance contract (tier + verification + io schemas)
// so it knows how the result will be judged, then hires via the spender and
// checks the result with the verifier. Pure fetch; no server deps, no auth
// (the directory is public). KEEP the shapes in sync with the API's
// services serialize (services/api/src/services/services.service.ts).

export type ServiceSort = 'trust' | 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface DiscoveryFilters {
  /** Free-text search over name/description/capabilities. */
  q?: string;
  category?: string;
  /** A capability the service must advertise. */
  capability?: string;
  tier?: Tier;
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

/** A service as seen in the public directory, with its acceptance contract. */
export interface DiscoveredService {
  id: string;
  agentId: string;
  name: string;
  description: string;
  category: string | null;
  capabilities: string[];
  pricingModel: string;
  pricePerCall: number;
  currency: string;
  endpoint: string;
  status: string;
  /** Verification tier: T1 trustless / T2 attestable / T3 human. */
  tier: Tier;
  /** How a delivery is judged (method + spec); null if unspecified. */
  verification: VerificationSpec | null;
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
  /** Settlement-gated trust level + signals. */
  trust: string;
  settlements: number;
  uniquePayers: number;
  /** Curated/vouched badge. */
  verified: boolean;
  /** Reliability score (0-5) and volume from real settled jobs. */
  rating: number;
  totalJobs: number;
}

export interface MarketplaceClientOptions {
  /** The CleverCon API base URL, e.g. https://cleverconapi-production.up.railway.app */
  baseUrl: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface MarketplaceClient {
  /** List/search the directory. Returns the matching services (one page). */
  listServices(filters?: DiscoveryFilters): Promise<DiscoveredService[]>;
  /** Full detail for one service by id (throws if not found). */
  getService(id: string): Promise<DiscoveredService>;
  /** The public protocol fee in basis points (0 = none). */
  platformFeeBps(): Promise<number>;
}

interface ApiService {
  id: string;
  agentId: string;
  name: string;
  description: string;
  category: string | null;
  capabilities?: string[];
  pricingModel: string;
  pricePerCall: number;
  currency: string;
  endpoint: string;
  status: string;
  tier?: Tier;
  verification?: VerificationSpec | null;
  inputSchema?: JsonSchema | null;
  outputSchema?: JsonSchema | null;
  trust?: string;
  settlements?: number;
  uniquePayers?: number;
  verified?: boolean;
  reputation?: { score: number; totalJobs: number } | null;
}

function mapService(s: ApiService): DiscoveredService {
  return {
    id: s.id,
    agentId: s.agentId,
    name: s.name,
    description: s.description,
    category: s.category,
    capabilities: s.capabilities ?? [],
    pricingModel: s.pricingModel,
    pricePerCall: s.pricePerCall,
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    tier: s.tier ?? 'T2',
    verification: s.verification ?? null,
    inputSchema: s.inputSchema ?? null,
    outputSchema: s.outputSchema ?? null,
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    uniquePayers: s.uniquePayers ?? 0,
    verified: !!s.verified,
    rating: s.reputation?.score ?? 0,
    totalJobs: s.reputation?.totalJobs ?? 0,
  };
}

/** Create a read client for the public CleverCon marketplace directory. */
export function createMarketplaceClient(opts: MarketplaceClientOptions): MarketplaceClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function getJson<T>(path: string): Promise<T> {
    const res = await doFetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`CleverCon directory ${path} -> HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listServices(filters: DiscoveryFilters = {}): Promise<DiscoveredService[]> {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
      }
      const qs = usp.toString();
      const res = await getJson<{ items: ApiService[] }>(`/services${qs ? `?${qs}` : ''}`);
      return res.items.map(mapService);
    },

    async getService(id: string): Promise<DiscoveredService> {
      return mapService(await getJson<ApiService>(`/services/${encodeURIComponent(id)}`));
    },

    async platformFeeBps(): Promise<number> {
      try {
        const { bps } = await getJson<{ bps: number }>('/services/fee');
        return bps;
      } catch {
        return 0;
      }
    },
  };
}
