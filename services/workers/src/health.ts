import { type PrismaClient, ServiceStatus } from '@clevercon/db';

/**
 * Periodic service health monitoring. A repeatable job sweeps every listable
 * service, GETs its /health endpoint, and records an AUTO-RECOVERING `healthy`
 * flag: a service is marked unhealthy only after several consecutive failures (so a
 * transient blip is tolerated) and flips back to healthy on the first success. This
 * flag is system-managed and distinct from the provider-controlled `status`; the
 * public directory hides unhealthy services but they return on their own when the
 * endpoint recovers, so a provider never has to manually un-pause after a blip.
 */

type FetchImpl = typeof fetch;

/** A single check times out fast so one slow endpoint never stalls the sweep. */
const HEALTH_TIMEOUT_MS = 8_000;
/** Consecutive failures before a service is marked unhealthy (tolerate blips). */
const UNHEALTHY_AFTER = 3;
/** How many endpoints to probe at once. */
const SWEEP_CONCURRENCY = 8;

/** The health URL for a service: its declared healthCheck, else `<endpoint>/health`. */
export function healthUrl(endpoint: string, healthCheck: string | null): string {
  if (healthCheck && healthCheck.trim()) return healthCheck.trim();
  try {
    return new URL('/health', endpoint).toString();
  } catch {
    return endpoint;
  }
}

export interface SweepResult {
  checked: number;
  healthy: number;
  unhealthy: number;
}

export interface SweepDeps {
  timeoutMs?: number;
  unhealthyAfter?: number;
  concurrency?: number;
}

/**
 * Probe every ACTIVE/NEW service once and update its health. Pure w.r.t. I/O (prisma
 * + fetch are injected) so it is unit-testable without Redis or a network. Returns a
 * small summary for logging. Best-effort per service: one failing probe never throws
 * out of the sweep.
 */
export async function sweepHealth(
  prisma: PrismaClient,
  fetchImpl: FetchImpl,
  deps: SweepDeps = {},
): Promise<SweepResult> {
  const timeoutMs = deps.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const unhealthyAfter = deps.unhealthyAfter ?? UNHEALTHY_AFTER;
  const concurrency = Math.max(1, deps.concurrency ?? SWEEP_CONCURRENCY);

  const services = await prisma.service.findMany({
    where: { status: { in: [ServiceStatus.ACTIVE, ServiceStatus.NEW] } },
    select: { id: true, endpoint: true, healthCheck: true, healthFailures: true },
  });

  const result: SweepResult = { checked: 0, healthy: 0, unhealthy: 0 };

  const probe = async (s: {
    id: string;
    endpoint: string;
    healthCheck: string | null;
    healthFailures: number;
  }): Promise<void> => {
    let ok = false;
    try {
      const res = await fetchImpl(healthUrl(s.endpoint, s.healthCheck), {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Reachable = healthy. Only a server error (5xx) counts as unhealthy; a 404 just
      // means the host is up but serves no /health route, so we must NOT hide it. A
      // connection failure / timeout throws below and is the real unhealthy signal.
      ok = res.status < 500;
    } catch {
      ok = false;
    }
    result.checked += 1;
    try {
      if (ok) {
        result.healthy += 1;
        await prisma.service.update({
          where: { id: s.id },
          data: { healthy: true, lastHealthyAt: new Date(), healthFailures: 0 },
        });
      } else {
        result.unhealthy += 1;
        const failures = s.healthFailures + 1;
        await prisma.service.update({
          where: { id: s.id },
          // Only flip `healthy` off once failures cross the threshold, so a single
          // blip does not remove a service; recovery (above) resets the counter.
          data: { healthFailures: failures, ...(failures >= unhealthyAfter ? { healthy: false } : {}) },
        });
      }
    } catch {
      // a health write is best-effort; never fail the sweep over one service
    }
  };

  // Bounded concurrency via fixed-size chunks (no extra deps).
  for (let i = 0; i < services.length; i += concurrency) {
    await Promise.all(services.slice(i, i + concurrency).map(probe));
  }
  return result;
}
