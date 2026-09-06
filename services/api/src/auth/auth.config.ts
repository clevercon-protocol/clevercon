import type { Keypair } from '@stellar/stellar-sdk';

/** DI token for the resolved SEP-10 auth configuration. */
export const AUTH_CONFIG = 'AUTH_CONFIG';

export interface AuthConfig {
  serverKeypair: Keypair;
  networkPassphrase: string;
  homeDomain: string;
  webAuthDomain: string;
}
