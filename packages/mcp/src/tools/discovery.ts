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

export async function searchServicesHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { q, category, sort, limit } = args;
    const client = createApiClient(config);
    return toolJson(await client.get('/services', { q, category, sort, limit }));
  } catch (error) {
    return toolError('search_services failed', error);
  }
}

export const getServiceSchema = {
  name: 'get_service',
  description: 'Get details for one service (name, provider, price per call, rating) by id.',
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
