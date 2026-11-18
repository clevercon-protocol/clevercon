// USDC Stellar Asset Contract addresses
export const USDC_SAC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
export const USDC_SAC_MAINNET = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI';
export const XLM_SAC_TESTNET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Network
export const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
export const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

// USDC issuer on testnet
export const USDC_ISSUER_TESTNET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// Mainnet (public network) values
export const MAINNET_HORIZON = 'https://horizon.stellar.org';
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
// Circle USDC issuer on Stellar mainnet
export const USDC_ISSUER_MAINNET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// x402 facilitator
export const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';

// External x402 services
export const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';
export const XLM402_TESTNET_PREFIX = '/testnet';

// Stellar Explorer
export const EXPLORER_BASE =
  process.env.NETWORK === 'mainnet' || process.env.NETWORK === 'public'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';
export const txExplorerUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const accountExplorerUrl = (addr: string) => `${EXPLORER_BASE}/account/${addr}`;
export const contractExplorerUrl = (id: string) => `${EXPLORER_BASE}/contract/${id}`;

// ── Network resolution ───────────────────────────────────────────────────────
export type NetworkName = 'testnet' | 'mainnet';

export interface NetworkConfig {
  network: NetworkName;
  isMainnet: boolean;
  passphrase: string;
  horizonUrl: string;
  /** Default Soroban RPC. Testnet has a public endpoint; mainnet must be set via STELLAR_RPC_URL. */
  defaultSorobanRpcUrl: string;
  usdcIssuer: string;
  usdcSac: string;
  explorerBase: string;
}

/**
 * Single source of truth for per-network values. 'mainnet' (or 'public') selects
 * the public network; anything else is testnet. Use this so no service silently
 * mixes networks.
 */
export function resolveNetwork(network?: string): NetworkConfig {
  const isMainnet = network === 'mainnet' || network === 'public';
  if (isMainnet) {
    return {
      network: 'mainnet',
      isMainnet: true,
      passphrase: MAINNET_PASSPHRASE,
      horizonUrl: MAINNET_HORIZON,
      defaultSorobanRpcUrl: '', // no free public mainnet RPC; require STELLAR_RPC_URL
      usdcIssuer: USDC_ISSUER_MAINNET,
      usdcSac: USDC_SAC_MAINNET,
      explorerBase: 'https://stellar.expert/explorer/public',
    };
  }
  return {
    network: 'testnet',
    isMainnet: false,
    passphrase: TESTNET_PASSPHRASE,
    horizonUrl: TESTNET_HORIZON,
    defaultSorobanRpcUrl: TESTNET_RPC,
    usdcIssuer: USDC_ISSUER_TESTNET,
    usdcSac: USDC_SAC_TESTNET,
    explorerBase: 'https://stellar.expert/explorer/testnet',
  };
}

/**
 * Fail fast when NETWORK=mainnet but the configured values are still testnet (or
 * the mainnet RPC is missing). Blocks the footgun of signing or indexing on the
 * wrong network because an env var was left at a testnet default.
 */
export function assertNetworkConsistent(
  network: string | undefined,
  values: { passphrase?: string; rpcUrl?: string; usdcIssuer?: string; usdcSac?: string },
): void {
  const cfg = resolveNetwork(network);
  if (!cfg.isMainnet) return; // the dangerous case is mainnet running with testnet values
  const bad: string[] = [];
  if (!values.rpcUrl) bad.push('STELLAR_RPC_URL is required on mainnet');
  if (values.rpcUrl && /testnet/i.test(values.rpcUrl))
    bad.push('STELLAR_RPC_URL points at testnet');
  if (values.passphrase && values.passphrase.includes('Test SDF'))
    bad.push('NETWORK_PASSPHRASE is the testnet passphrase');
  if (values.usdcIssuer && values.usdcIssuer === USDC_ISSUER_TESTNET)
    bad.push('USDC issuer is the testnet issuer');
  if (values.usdcSac && values.usdcSac === USDC_SAC_TESTNET)
    bad.push('USDC_SAC is the testnet contract');
  if (bad.length > 0) {
    throw new Error(
      `NETWORK=mainnet but the configuration is not mainnet-ready:\n  - ${bad.join('\n  - ')}\n` +
        'Set the correct mainnet values before starting.',
    );
  }
}
