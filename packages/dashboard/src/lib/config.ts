/**
 * Runtime configuration for the dashboard.
 *
 * This is additive and non-destructive. When served by the orchestrator
 * (local dev, single-host deploy), leave VITE_API_URL empty and
 * VITE_BACKEND_ENABLED unset: the app talks to the backend on the same
 * origin, exactly as before.
 *
 * For a temporary standalone deploy (e.g. Vercel) with no backend, set:
 *   VITE_BACKEND_ENABLED=false
 * Backend-only features (task orchestration, agent registry, activity feed,
 * history) then degrade to empty/offline states, while wallet connect and
 * direct on-chain interactions stay live against Stellar testnet. Reconnecting
 * the backend later is a single env-var flip.
 */

const env = import.meta.env as Record<string, string | undefined>;

/** Base URL for backend REST calls. Empty string means same-origin. */
export const API_BASE = env.VITE_API_URL ?? '';

/** Whether a backend (orchestrator + registry) is available. */
export const BACKEND_ENABLED = (env.VITE_BACKEND_ENABLED ?? 'true') !== 'false';

/** WebSocket URL for the live activity feed. Empty means derive from origin. */
export const WS_URL = env.VITE_WS_URL ?? '';

// ── On-chain configuration (Stellar testnet defaults) ─────────────────────────

export const SOROBAN_RPC_URL =
  env.VITE_SOROBAN_RPC ?? 'https://soroban-testnet.stellar.org';

export const HORIZON_URL =
  env.VITE_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

export const NETWORK_PASSPHRASE =
  env.VITE_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

/** CleverVault contract id. Override per deployment via VITE_VAULT_CONTRACT_ID. */
export const VAULT_CONTRACT_ID =
  env.VITE_VAULT_CONTRACT_ID ??
  'CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO';

/** USDC Stellar Asset Contract id on testnet. */
export const USDC_SAC =
  env.VITE_USDC_SAC ??
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

/** Classic USDC issuer on testnet, for the trustline. */
export const USDC_ISSUER =
  env.VITE_USDC_ISSUER ??
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/** Thrown by backend-only calls when no backend is configured. */
export class BackendOfflineError extends Error {
  constructor() {
    super('This feature needs the orchestrator, which is offline in this demo.');
    this.name = 'BackendOfflineError';
  }
}
