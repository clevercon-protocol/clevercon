import { z } from 'zod';

/**
 * Typed, fail-fast environment validation. The app refuses to boot with an
 * invalid config and prints exactly what's wrong.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4100),
  NETWORK: z.enum(['local', 'testnet', 'mainnet']).default('testnet'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  // SEP-10 wallet auth. If SERVER_SIGNING_KEY is unset, an ephemeral key is used
  // (dev only; challenges do not survive a restart).
  SERVER_SIGNING_KEY: z.string().optional(),
  NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  HOME_DOMAIN: z.string().default('localhost'),
  WEB_AUTH_DOMAIN: z.string().default('localhost'),
  LOG_LEVEL: z.string().default('info'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
