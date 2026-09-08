import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export interface PolicyRules {
  perPaymentCeilingUsdc?: number;
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  allowlist?: string[];
  denylist?: string[];
  denylistThresholdUsdc?: number;
}

export interface Policy {
  id: string;
  commitment: string;
  isPrivate: boolean;
  rules: PolicyRules | null;
  createdAt: string;
}

const demoPolicies: Policy[] = [
  {
    id: 'pol-demo-1',
    commitment: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    isPrivate: false,
    rules: { perPaymentCeilingUsdc: 0.5, rollingCapUsdc: 20, rollingWindowSecs: 86400 },
    createdAt: '2026-09-06T12:00:00Z',
  },
];

/** The session's spending policies: demo data in demo mode, the live API otherwise. */
export async function getPolicies(): Promise<Policy[]> {
  if (isDemo()) return demoPolicies;
  const res = await apiFetch<{ items: Policy[] }>('/policies');
  return res.items;
}

/** Create a policy. Private (ZK) mode is gated until the prover lands. */
export async function createPolicy(rules: PolicyRules, isPrivate: boolean): Promise<Policy> {
  if (isDemo()) {
    return {
      id: 'pol-' + Date.now(),
      commitment: Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join(''),
      isPrivate: false,
      rules,
      createdAt: new Date().toISOString(),
    };
  }
  return apiPost<Policy>('/policies', { rules, isPrivate });
}
