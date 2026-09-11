import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export const WEBHOOK_EVENTS = ['task.completed', 'task.failed'] as const;

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface CreatedWebhook extends Webhook {
  secret: string; // shown once
}

export async function getWebhooks(): Promise<Webhook[]> {
  if (isDemo()) return [];
  const res = await apiFetch<{ items: Webhook[] }>('/webhooks');
  return res.items;
}

export async function createWebhook(url: string, events: string[]): Promise<CreatedWebhook> {
  return apiPost<CreatedWebhook>('/webhooks', { url, events });
}

export async function deleteWebhook(id: string): Promise<void> {
  await apiFetch(`/webhooks/${id}`, { method: 'DELETE' });
}
