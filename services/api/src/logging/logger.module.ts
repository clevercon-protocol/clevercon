import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Structured logging for the whole API.
 *
 * nestjs-pino routes every Nest `Logger` call and every HTTP request through
 * pino, so logs are JSON in production (one line per event, ready for a log
 * pipeline) and pretty-printed locally. Each request gets a correlation id
 * (reused from an inbound `x-request-id` header or generated), attached to a
 * per-request child logger, so logs from many concurrent users stay traceable
 * end to end. Auth material is redacted so tokens never reach the logs.
 */
const isProd = process.env.NODE_ENV === 'production';

export const AppLoggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Pretty output for humans locally; raw JSON in production for ingestion.
    transport: isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
    // One correlation id per request; honour an upstream one if the proxy set it.
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const existing = req.headers['x-request-id'];
      const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Keep request logs lean and drop noisy health-probe lines.
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === '/health',
    },
    customProps: () => ({ context: 'HTTP' }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  },
});
