import type { FeedbackOutcome, Logger, RegistrationPayload } from './types.js';

/** Backoff schedule for a registry that is not up yet — fast at first, then
 *  a steady 60s. Distilled from the five agents' `register.ts`. */
export const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000] as const;
export const HEARTBEAT_MS = 4 * 60 * 1000;

export interface RegistryClientOptions {
  registryUrl: string;
  manifest: RegistrationPayload;
  /** The agent's own Stellar address — authorises deregistration. */
  requesterAddress: string;
  logger: Logger;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Re-register interval once registered. `0` disables the heartbeat. */
  heartbeatMs?: number;
  /** Label for log lines, e.g. the agent name. */
  label?: string;
}

export interface RegistryClient {
  /** Register now; on failure, schedule a backoff retry; on success, schedule
   *  the heartbeat. Resolves after the first attempt (success or failure) —
   *  retries continue in the background so the agent still serves traffic. */
  registerSelf(): Promise<void>;
  deregister(): Promise<void>;
  reportFeedback(jobId: string, outcome: FeedbackOutcome): Promise<void>;
  /** Cancel any pending retry / heartbeat timer. */
  stop(): void;
}

export function createRegistryClient(opts: RegistryClientOptions): RegistryClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const label = opts.label ?? opts.manifest.name;
  const registerUrl = `${opts.registryUrl}/register`;
  const feedbackUrl = `${opts.registryUrl}/feedback`;
  const agentUrl = `${opts.registryUrl}/agents/${encodeURIComponent(opts.manifest.agent_id)}`;

  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function schedule(delayMs: number): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void attemptRegister();
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function attemptRegister(): Promise<void> {
    if (stopped) return;
    try {
      const res = await doFetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.manifest),
      });
      if (res.ok) {
        attempt = 0;
        opts.logger.info(`[${label}] registered with registry at ${opts.registryUrl}`);
        if (heartbeatMs > 0) schedule(heartbeatMs);
        return;
      }
      opts.logger.warn(`[${label}] registry rejected registration: HTTP ${res.status}`);
    } catch (err) {
      opts.logger.warn(`[${label}] registry unreachable: ${(err as Error).message}`);
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    attempt += 1;
    opts.logger.warn(`[${label}] retrying registration in ${delay / 1000}s`);
    schedule(delay);
  }

  return {
    registerSelf: attemptRegister,

    async deregister(): Promise<void> {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        const res = await doFetch(agentUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requester_address: opts.requesterAddress }),
        });
        if (res.ok) {
          opts.logger.info(`[${label}] deregistered from registry`);
        } else {
          opts.logger.warn(`[${label}] deregister failed: HTTP ${res.status}`);
        }
      } catch (err) {
        opts.logger.warn(`[${label}] deregister request failed: ${(err as Error).message}`);
      }
    },

    async reportFeedback(jobId: string, outcome: FeedbackOutcome): Promise<void> {
      const body = {
        agent_id: opts.manifest.agent_id,
        job_id: jobId,
        success: outcome.success,
        quality_rating: outcome.quality_rating ?? (outcome.success ? 3 : 1),
        latency_ms: outcome.latency_ms ?? 0,
        timestamp: new Date().toISOString(),
      };
      const res = await doFetch(feedbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`feedback rejected by registry: HTTP ${res.status}`);
      }
    },

    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
