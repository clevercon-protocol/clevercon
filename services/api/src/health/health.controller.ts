import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';

/** Injection token for the readiness probe's Redis client (defined here so the
 *  module can import it without a circular module<->controller reference). */
export const HEALTH_REDIS = 'HEALTH_REDIS';

type Check = 'up' | 'down' | 'disabled';

/** Bound a dependency probe so a hung dependency never hangs the health check. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Liveness and readiness probes. Probes hit these on a tight interval, so they
 * opt out of rate limiting and request logging (see LoggerModule).
 */
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(HEALTH_REDIS) private readonly redis: Redis | null,
  ) {}

  /**
   * Liveness: the process is up and serving. Deliberately checks no dependencies,
   * so a transient Postgres/Redis outage never makes an orchestrator kill an
   * otherwise-healthy instance (that is readiness' job).
   */
  @Get('health')
  live(): { status: string; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /**
   * Readiness: should a load balancer send this instance traffic? Gated on the
   * critical dependencies (Postgres and Redis); the Soroban RPC is reported but
   * not gating, since most routes serve without it. Returns 503 when a critical
   * dependency is down so the instance is drained; 200 (status `degraded`) when
   * only the RPC is down.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{
    status: 'ready' | 'degraded' | 'not_ready';
    checks: { db: Check; redis: Check; rpc: Check };
    ts: string;
  }> {
    const [db, redis, rpc] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkRpc(),
    ]);
    // Redis 'disabled' (no REDIS_URL, e.g. local/tests) does not fail readiness.
    const critical = db === 'up' && redis !== 'down';
    const status = !critical ? 'not_ready' : rpc === 'down' ? 'degraded' : 'ready';
    res.status(critical ? 200 : 503);
    return { status, checks: { db, redis, rpc }, ts: new Date().toISOString() };
  }

  private async checkDb(): Promise<Check> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2500);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<Check> {
    if (!this.redis) return 'disabled';
    try {
      await withTimeout(this.redis.ping(), 2000);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRpc(): Promise<Check> {
    const url = process.env.STELLAR_RPC_URL;
    if (!url) return 'disabled';
    // A direct JSON-RPC getHealth ping: lighter than building a Soroban client,
    // and avoids an SDK fetch quirk that rejects health calls in some runtimes.
    try {
      // 5s: the first outbound call from a cold process pays DNS + TLS setup, so
      // a tight timeout would report a false `down` right after start.
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        }),
        5000,
      );
      if (!res.ok) return 'down';
      const body = (await res.json()) as { result?: { status?: string } };
      return body?.result?.status === 'healthy' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
