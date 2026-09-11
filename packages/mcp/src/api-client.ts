/**
 * Minimal CleverCon API client for the hire-flow MCP tools. Talks to the same
 * public HTTP API the console and SDKs use, authenticating with an x-api-key so
 * an agent framework drives the rail exactly as a developer would. Kept as pure
 * functions over an injectable fetch so it is testable without a network.
 */

export interface ApiConfig {
  /** Base URL of the CleverCon API (no trailing slash needed). */
  api_url: string;
  /** Scoped API key (cc_...); required for task actions. */
  api_key?: string;
}

/** An API call that failed; carries the HTTP status so callers can explain it. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Build a URL with only the defined, non-empty query params appended. */
export function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, unknown> = {},
): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Turn a failed response into a helpful message (quota, auth, or the API's own). */
async function toApiError(res: Response): Promise<ApiError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = typeof body?.message === 'string' ? body.message : JSON.stringify(body);
  } catch {
    detail = await res.text().catch(() => '');
  }
  if (res.status === 401) return new ApiError(401, 'Unauthorized: check CLEVERCON_API_KEY');
  if (res.status === 429)
    return new ApiError(429, `Daily API quota exceeded${detail ? `: ${detail}` : ''}`);
  return new ApiError(res.status, detail || `HTTP ${res.status}`);
}

const TIMEOUT_MS = 15_000;

export function createApiClient(config: ApiConfig, fetchImpl: typeof fetch = fetch) {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (config.api_key) h['x-api-key'] = config.api_key;
    return h;
  };

  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string, query?: Record<string, unknown>) =>
      request<T>('GET', buildUrl(config.api_url, path, query)),
    post: <T>(path: string, body?: unknown) =>
      request<T>('POST', buildUrl(config.api_url, path), body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Standard MCP tool result carrying pretty JSON (or an error message). */
export type ToolResult = { content: Array<{ type: 'text'; text: string }> };

export function toolJson(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Format any thrown error (API or otherwise) as a readable tool result. */
export function toolError(context: string, err: unknown): ToolResult {
  const message =
    err instanceof ApiError
      ? `CleverCon API error (${err.status}): ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return toolJson({ error: context, message });
}
