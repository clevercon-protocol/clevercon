/**
 * Discovery tools over the live rail: browse the curated directory of services an
 * agent can hire and pay. Replaces the old registry-based search (the two-sided
 * marketplace stack); this reads the same API the console and SDK use.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const searchServicesSchema = {
  name: 'search_services',
  description:
    'Browse the CleverCon directory of services an agent can hire and pay. Filter by text and category; sort by recent, rating, or price.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Free-text search' },
      category: { type: 'string' },
      sort: { type: 'string', enum: ['recent', 'rating', 'price_asc', 'price_desc'] },
      limit: { type: 'number', minimum: 1, maximum: 100 },
    },
  },
};

type Svc = Record<string, unknown>;

/** A lean list projection: enough to pick a service and hire a function, without the
 *  full input schemas + requirements (those come from get_service). Keeps the payload
 *  small so a directory scan does not flood the agent's context. */
function leanService(s: Svc): Svc {
  const fns = Array.isArray(s.functions) ? (s.functions as Svc[]) : [];
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    tier: s.tier,
    pricePerCall: s.pricePerCall,
    interaction: s.interaction,
    paymentModel: s.paymentModel,
    rating: s.rating ?? s.trust,
    settlements: s.settlements,
    healthy: s.healthy,
    functions: fns.map((f) => ({ key: f.key, label: f.label, pricing: f.pricing })),
  };
}

export async function searchServicesHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { q, category, sort, limit } = args;
    const client = createApiClient(config);
    const res = await client.get<{ items?: Svc[]; total?: number }>('/services', {
      q,
      category,
      sort,
      limit,
    });
    const items = Array.isArray(res?.items) ? res.items.map(leanService) : res;
    return toolJson({
      items,
      total: res?.total,
      note: "Lean list. Call get_service for a service's full input schemas and usage requirements.",
    });
  } catch (error) {
    return toolError('search_services failed', error);
  }
}

export const getServiceSchema = {
  name: 'get_service',
  description:
    'Get details for one service by id: name, owner, pricing, rating, usage requirements, ' +
    'and its `functions` (each with a key, price, and input schema). When hiring a service ' +
    'that lists functions, pass the chosen function’s key as functionKey to hire_agent.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Service id' } },
    required: ['id'],
  },
};

export async function getServiceHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { id } = args;
    if (typeof id !== 'string' || id === '') throw new Error('id is required');
    const client = createApiClient(config);
    return toolJson(await client.get(`/services/${encodeURIComponent(id)}`));
  } catch (error) {
    return toolError('get_service failed', error);
  }
}
