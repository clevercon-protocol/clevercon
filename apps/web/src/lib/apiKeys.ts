import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';
import { demoApiKeys } from './demo';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  key: string; // the full secret, shown exactly once
}

/** The caller's API keys: demo data in demo mode, the live API otherwise. */
export async function getApiKeys(): Promise<ApiKey[]> {
  if (isDemo()) {
    return demoApiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: [],
      lastUsedAt: k.lastUsed,
      requestCount: 0,
      createdAt: k.created,
      revokedAt: null,
    }));
  }
  return apiFetch<ApiKey[]>('/api-keys');
}

/** Create a key. In demo mode this fabricates a plausible secret to show the UX. */
export async function createApiKey(name: string): Promise<CreatedApiKey> {
  if (isDemo()) {
    const prefix = 'cc_' + Math.random().toString(36).slice(2, 8);
    return {
      id: 'demo-' + Date.now(),
      name,
      prefix,
      scopes: [],
      key: `${prefix}.${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
    };
  }
  return apiPost<CreatedApiKey>('/api-keys', { name });
}

export async function revokeApiKey(id: string): Promise<void> {
  if (isDemo()) return;
  await apiFetch(`/api-keys/${id}`, { method: 'DELETE' });
}
