/**
 * Shared Prisma client for CleverCon services (api, indexer, workers).
 *
 * Exposes a single pooled PrismaClient. A global singleton avoids exhausting
 * Postgres connections during dev hot-reload; in production each stateless
 * instance keeps one client.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
