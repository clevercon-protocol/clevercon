import { isDemo } from '../config';
import { apiFetch } from './api';
import { useSession, type Role } from '../store/session';

/**
 * Re-read the current user's roles from the API and update the session. Call
 * after an action that can grant a new role (e.g. creating an API key grants
 * DEVELOPER) so the nav reflects it without requiring a re-login.
 */
export async function refreshRoles(): Promise<void> {
  if (isDemo()) return;
  const me = await apiFetch<{ roles: Role[] }>('/me');
  const current = useSession.getState().session;
  if (current) useSession.getState().setSession({ ...current, roles: me.roles });
}
