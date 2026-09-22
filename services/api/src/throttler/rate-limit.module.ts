import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';

/**
 * Global rate limiting.
 *
 * The store is Redis-backed when REDIS_URL is set so the limit is shared across
 * every API instance (horizontal scale): a client gets one budget no matter
 * which replica a request lands on. Without REDIS_URL it falls back to an
 * in-memory store (local dev and tests), which is per-process but fine there.
 *
 * The default throttler protects every route; sensitive endpoints tighten it
 * further with `@Throttle` (see AuthController) and health checks opt out with
 * `@SkipThrottle`. Tracking is per client IP, so `TRUST_PROXY` must be set when
 * running behind a load balancer for the real client IP to be used.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const url = process.env.REDIS_URL;
        return {
          throttlers: [{ name: 'default', ttl: seconds(60), limit: 120 }],
          storage: url
            ? new ThrottlerStorageRedisService(new Redis(url, { maxRetriesPerRequest: null }))
            : undefined,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
