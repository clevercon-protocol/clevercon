import { config } from '../config';
import { useSession } from '../store/session';

/** Attempt a refresh-token rotation. Returns true on success. */
async function tryRefresh(): Promise<boolean> {
  const rt = useSession.getState().session?.refreshToken;
  if (!rt) return false;
  const res = await fetch(`${config.apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });
  if (!res.ok) {
    useSession.getState().clear();
    return false;
  }
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  const current = useSession.getState().session;
  if (current) {
    useSession.getState().setSession({
      ...current,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    });
  }
  return true;
}

/** Authenticated fetch against the API, with one refresh-on-401 retry. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = () => {
    const token = useSession.getState().session?.accessToken;
    return fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  };

  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
