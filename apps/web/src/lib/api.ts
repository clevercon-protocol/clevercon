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
  if (!res.ok) {
    // Surface the API's human message (NestJS returns { message, error, statusCode })
    // rather than a raw "API 503: {json}" dump, so callers can show it as-is.
    const text = await res.text();
    let message = text;
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // not JSON; keep the raw text
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string): Promise<T> => apiFetch<T>(path);

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
