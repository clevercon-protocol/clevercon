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

// x402 facilitator
export const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';

// External x402 services
export const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';
export const XLM402_TESTNET_PREFIX = '/testnet';

// Stellar Explorer
export const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet';
export const txExplorerUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const accountExplorerUrl = (addr: string) => `${EXPLORER_BASE}/account/${addr}`;
export const contractExplorerUrl = (id: string) => `${EXPLORER_BASE}/contract/${id}`;
