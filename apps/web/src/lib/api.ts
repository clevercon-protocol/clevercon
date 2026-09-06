import { config } from '../config';
import { useSession } from '../store/session';

/** Authenticated fetch against the API. Only used in full (non-demo) mode. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useSession.getState().session?.accessToken;
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
