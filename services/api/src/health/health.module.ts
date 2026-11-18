import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { HealthController, HEALTH_REDIS } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_REDIS,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null; // local/tests without Redis: readiness reports it disabled
        // A dedicated client for readiness pings: fail a command fast (one retry)
        // instead of queueing forever, and never crash the process on a transient
        // connection error (the probe reports the state instead).
        const client = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
        client.on('error', () => {});
        return client;
      },
    },
  ],
})
export class HealthModule {}
