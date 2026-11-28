import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export interface MeEmail {
  email: string | null;
  emailVerified: boolean;
  emailDelivery: boolean; // whether the server has email delivery configured
}

export async function getMeEmail(): Promise<MeEmail> {
  if (isDemo()) return { email: null, emailVerified: false, emailDelivery: false };
  const me = await apiFetch<MeEmail>('/me');
  return { email: me.email, emailVerified: me.emailVerified, emailDelivery: me.emailDelivery };
}

export async function setEmail(
  email: string,
): Promise<{ email: string; verificationSent: boolean; emailDelivery: boolean }> {
  return apiPost('/me/email', { email });
}

export async function verifyEmail(code: string): Promise<{ ok: boolean; verified: boolean }> {
  return apiPost('/me/email/verify', { code });
}

export async function removeEmail(): Promise<{ ok: boolean }> {
  return apiFetch('/me/email', { method: 'DELETE' });
}

export interface NotificationPrefs {
  emailEnabled: boolean;
  types: { type: string; label: string; email: boolean }[];
}

export async function getNotificationPreferences(): Promise<NotificationPrefs> {
  if (isDemo()) return { emailEnabled: false, types: [] };
  return apiFetch<NotificationPrefs>('/notifications/preferences');
}

export async function setNotificationPreference(
  type: string,
  email: boolean,
): Promise<{ ok: boolean }> {
  return apiPost('/notifications/preferences', { type, email });
}
