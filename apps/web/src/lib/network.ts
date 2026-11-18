// Browser-safe per-network config, driven by VITE_NETWORK (testnet by default).
// Mirrors the backend resolveNetwork() in @clevercon/common, but without any node
// dependencies so it is safe in the eager frontend bundle.
const raw = (import.meta.env.VITE_NETWORK ?? 'testnet').toString();
export const IS_MAINNET = raw === 'mainnet' || raw === 'public';
export const NETWORK: 'testnet' | 'mainnet' = IS_MAINNET ? 'mainnet' : 'testnet';

export const NETWORK_PASSPHRASE = IS_MAINNET
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015';

export const HORIZON_URL = IS_MAINNET
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export const USDC_ISSUER = IS_MAINNET
  ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
  : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const EXPLORER_BASE = IS_MAINNET
  ? 'https://stellar.expert/explorer/public'
  : 'https://stellar.expert/explorer/testnet';

export const explorerAccount = (address: string): string => `${EXPLORER_BASE}/account/${address}`;
export const explorerTx = (hash: string): string => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerContract = (id: string): string => `${EXPLORER_BASE}/contract/${id}`;
