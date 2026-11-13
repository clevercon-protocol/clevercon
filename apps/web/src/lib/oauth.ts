import { isDemo } from '../config';
import { apiGet, apiPost } from './api';

/** Whether the server has GitHub OAuth configured (shows the Connect button). */
export async function getGithubOAuthStatus(): Promise<{ configured: boolean }> {
  if (isDemo()) return { configured: false };
  try {
    return await apiGet<{ configured: boolean }>('/oauth/github/status');
  } catch {
    return { configured: false };
  }
}

/** Get the GitHub authorize URL to redirect the browser to, for this service. */
export async function getGithubAuthorizeUrl(serviceId: string, key: string): Promise<string> {
  const { url } = await apiPost<{ url: string }>('/oauth/github/authorize-url', { serviceId, key });
  return url;
}
