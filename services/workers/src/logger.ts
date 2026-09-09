import { pino } from 'pino';

/**
 * Structured logger for the worker process, matching the API's format: JSON in
 * production for ingestion, pretty locally. Job logs carry the taskId so a
 * single task can be traced across the API (which enqueued it) and here.
 */
const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'workers' },
  transport: isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
});
