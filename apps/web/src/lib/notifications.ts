import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: { taskId?: string; serviceId?: string; disputeId?: string; reviewId?: string } | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsPage {
  items: Notification[];
  unread: number;
}

/** The caller's notification feed (newest first) + the unread count. */
export async function getNotifications(limit = 20): Promise<NotificationsPage> {
  if (isDemo()) return { items: [], unread: 0 };
  return apiFetch<NotificationsPage>(`/notifications?limit=${limit}`);
}

/** Just the unread count (cheap; polled for the bell badge). */
export async function getUnreadCount(): Promise<number> {
  if (isDemo()) return 0;
  const res = await apiFetch<{ unread: number }>('/notifications/unread-count');
  return res.unread;
}

export async function markRead(ids: string[]): Promise<{ updated: number }> {
  if (isDemo()) return { updated: 0 };
  return apiPost<{ updated: number }>('/notifications/read', { ids });
}

export async function markAllRead(): Promise<{ updated: number }> {
  if (isDemo()) return { updated: 0 };
  return apiPost<{ updated: number }>('/notifications/read-all', {});
}

/** The in-app route a notification deep-links to (best-effort, from its data). */
export function notificationHref(n: Notification): string | null {
  if (n.data?.taskId) return `/app/tasks/${n.data.taskId}`;
  if (n.data?.serviceId) return `/app/marketplace/${n.data.serviceId}`;
  return null;
}
