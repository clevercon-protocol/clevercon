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
  // Number of trusted proxy hops in front of the API (load balancer / ingress).
  // Controls Express `trust proxy` so rate limiting sees the real client IP from
  // X-Forwarded-For instead of the proxy's. Keep 0 for direct local runs.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  // SEP-10 wallet auth. If SERVER_SIGNING_KEY is unset, an ephemeral key is used
  // (dev only; challenges do not survive a restart).
  SERVER_SIGNING_KEY: z.string().optional(),
  NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  HOME_DOMAIN: z.string().default('localhost'),
  WEB_AUTH_DOMAIN: z.string().default('localhost'),
  LOG_LEVEL: z.string().default('info'),
  // OpenTelemetry: tracing is off unless OTEL_EXPORTER_OTLP_ENDPOINT points at a
  // collector (e.g. http://localhost:4318). Read in src/tracing.ts at startup.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('clevercon-api'),
  // CleverVault (Soroban). Optional: when the contract id is unset or a
  // placeholder the vault client stays inactive and deposit/withdraw report
  // "not configured" instead of touching the chain.
  AGENT_VAULT_CONTRACT_ID: z.string().optional(),
  STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  USDC_SAC: z.string().optional(),
  // Deployed policy-verifier (Phase 3). When set, the app knows which on-chain
  // verifier gates proof-backed releases; the vault's set_policy_verifier must
  // point here for release_payment_proved to succeed.
  POLICY_VERIFIER_CONTRACT_ID: z.string().optional(),
  // Platform delegate (orchestrator) secret. The user authorizes this key once
  // via register_orchestrator; it then signs create_task (lock) and
  // release_payment_proved (settle) on their behalf, bounded by the vault policy
  // so it can never overspend. When unset, automatic settlement is disabled
  // (tasks run off-chain only). Keep in KMS in production, never in git.
  SERVER_ORCHESTRATOR_KEY: z.string().optional(),
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
