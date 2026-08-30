import { Keypair } from '@stellar/stellar-sdk';
import type { AgentConfig, RegistrationPayload } from './types.js';

const DEFAULT_REGISTRY_URL = 'http://localhost:4000';
const DEFAULT_NETWORK = 'stellar:testnet';
const DEFAULT_FACILITATOR_URL = 'https://www.x402.org/facilitator';
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_TASK_PATH = '/query';
const DEFAULT_HEARTBEAT_MS = 4 * 60 * 1000;

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(`agent-sdk: ${message}`);
    this.name = 'AgentConfigError';
  }
}

export interface ResolvedConfig {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];
  price: number;
  currency: 'USDC';
  payment: 'x402' | 'mpp';
  secretKey: string;
  publicKey: string;
  registryUrl: string;
  port: number;
  selfUrl: string | null;
  taskPath: string;
  network: string;
  facilitatorUrl: string;
  rpcUrl: string;
  realm: string;
  cors: boolean;
  gracefulShutdown: boolean;
  syncFacilitatorOnStart: boolean;
  heartbeatMs: number;
}

/** Validate and normalise an {@link AgentConfig}. Throws {@link AgentConfigError}
 *  with a clear message on the first problem — call this at construction so a
 *  misconfigured agent fails fast instead of at first request. */
export function resolveConfig(config: AgentConfig): ResolvedConfig {
  if (!config || typeof config !== 'object') {
    throw new AgentConfigError('config object is required');
  }

  const { manifest } = config;
  if (!manifest || typeof manifest !== 'object') {
    throw new AgentConfigError('manifest is required');
  }
  for (const field of ['agent_id', 'name', 'description'] as const) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      throw new AgentConfigError(`manifest.${field} is required`);
    }
  }

  if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
    throw new AgentConfigError('capabilities must be a non-empty string array');
  }
  if (config.capabilities.some((c) => typeof c !== 'string' || !c.trim())) {
    throw new AgentConfigError('capabilities must all be non-empty strings');
  }

  if (typeof config.price !== 'number' || !Number.isFinite(config.price) || config.price <= 0) {
    throw new AgentConfigError('price must be a positive number (USDC per call)');
  }

  if (config.payment !== 'x402' && config.payment !== 'mpp') {
    throw new AgentConfigError(`payment must be 'x402' or 'mpp' (got ${String(config.payment)})`);
  }

  if (typeof config.handler !== 'function') {
    throw new AgentConfigError('handler must be a function');
  }

  const secretKey = config.wallet?.secretKey;
  if (!secretKey || typeof secretKey !== 'string') {
    throw new AgentConfigError('wallet.secretKey is required');
  }
  let publicKey: string;
  try {
    publicKey = Keypair.fromSecret(secretKey).publicKey();
  } catch {
    throw new AgentConfigError('wallet.secretKey is not a valid Stellar secret key');
  }

  const taskPath = config.taskPath ?? DEFAULT_TASK_PATH;
  if (!taskPath.startsWith('/')) {
    throw new AgentConfigError("taskPath must start with '/'");
  }

  const heartbeatMs = config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (typeof heartbeatMs !== 'number' || heartbeatMs < 0) {
    throw new AgentConfigError('heartbeatMs must be a non-negative number');
  }

  const envPort = process.env.PORT ? Number(process.env.PORT) : NaN;
  const port = config.port ?? (Number.isInteger(envPort) ? envPort : 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new AgentConfigError('port must be an integer between 0 and 65535');
  }

  return {
    agentId: manifest.agent_id,
    name: manifest.name,
    description: manifest.description,
    capabilities: [...config.capabilities],
    price: config.price,
    currency: config.currency ?? 'USDC',
    payment: config.payment,
    secretKey,
    publicKey,
    registryUrl: (config.registryUrl ?? process.env.REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(
      /\/$/,
      '',
    ),
    port,
    selfUrl: config.selfUrl ?? process.env.SELF_URL ?? null,
    taskPath,
    network: config.network ?? process.env.STELLAR_NETWORK ?? DEFAULT_NETWORK,
    facilitatorUrl:
      config.facilitatorUrl ?? process.env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
    rpcUrl: config.rpcUrl ?? DEFAULT_RPC_URL,
    realm: config.realm ?? `clevercon-${manifest.agent_id}`,
    cors: config.cors ?? true,
    gracefulShutdown: config.gracefulShutdown ?? true,
    syncFacilitatorOnStart: config.syncFacilitatorOnStart ?? true,
    heartbeatMs,
  };
}

/** Build the `/register` payload from resolved config plus the resolved self URL. */
export function buildManifest(resolved: ResolvedConfig, selfUrl: string): RegistrationPayload {
  const base = selfUrl.replace(/\/$/, '');
  return {
    agent_id: resolved.agentId,
    name: resolved.name,
    description: resolved.description,
    capabilities: resolved.capabilities,
    pricing: {
      model: resolved.payment,
      price_per_call: resolved.price,
      currency: resolved.currency,
    },
    endpoint: `${base}${resolved.taskPath}`,
    stellar_address: resolved.publicKey,
    health_check: `${base}/health`,
  };
}
