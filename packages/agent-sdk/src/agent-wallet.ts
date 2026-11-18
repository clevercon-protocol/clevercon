/**
 * Agent-key mode: one object that unites the two non-custodial halves of an
 * autonomous agent's economy.
 *
 *   const wallet = createAgentWallet({
 *     apiKey: process.env.CLEVERCON_API_KEY!,   // the governed vault side
 *     secretKey: process.env.AGENT_SECRET_KEY!, // the agent's OWN Stellar key
 *   });
 *
 *   await wallet.topUp(5);                       // pull USDC from the vault (policy-bounded)
 *   const res = await wallet.fetch(url, init);   // pay an x402 service with those funds
 *
 * The agent PULLS working capital from the CleverCon vault with `topUp` (a normal
 * bounded spend: the release is enforced on-chain by the owner's policy), then
 * SPENDS it autonomously on external x402 services with `fetch` (each 402 is
 * settled by the agent's own key). The platform never holds the agent's key, and
 * the vault owner sets the ceiling the agent can ever pull. This is the same USDC
 * on both legs: the vault dispenses the Stellar testnet/mainnet USDC that the
 * x402 exact-scheme settles in, so the two economies compose without a swap.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { createSpender, type Budget, type CleverConClient } from './spender.js';
import { createSessionSpender } from './sessions.js';
import { createPayingFetch } from './payments/x402.js';

export interface AgentWalletOptions {
  /** Scoped CleverCon API key (cc_...): the governed vault side. */
  apiKey: string;
  /** The agent's OWN Stellar secret. Non-custodial: only the agent ever holds it. */
  secretKey: string;
  /** CleverCon API base. Defaults to CLEVERCON_API_URL, or the live CleverCon API. */
  apiUrl?: string;
  /** x402 network (default STELLAR_NETWORK or `stellar:testnet`). */
  network?: string;
  /**
   * Vault + asset config that lets `topUp` pull working capital on the PUBLIC
   * (session) lane: the agent signs `release_payment_session` with its OWN key, so
   * the owner must have registered this agent key as a session whose allowlist
   * includes the agent's address (SDK `registerSession`, or the dapp). Without this,
   * `topUp` throws - fund the agent via `clevercon.disbursePrivate` (private lane)
   * instead.
   */
  vault?: { vaultId: string; usdcSac: string; rpcUrl?: string; networkPassphrase?: string };
  /** Override fetch for the CleverCon control calls (tests). */
  fetchImpl?: typeof fetch;
  /** Timeout for CleverCon control calls in ms. */
  timeoutMs?: number;
}

export interface AgentWallet {
  /** The agent's Stellar address (its own hot wallet, funded by `topUp`). */
  readonly address: string;
  /**
   * Pull USDC from the CleverCon vault into THIS wallet on the public (Fast) lane:
   * the agent signs `release_payment_session` with its own key, bounded on-chain by
   * the session scope the owner authorized (budget + allowlist + expiry). Requires
   * `vault` config in the options and the agent key registered as a session whose
   * allowlist includes this address; otherwise it throws. Returns the release tx
   * hash. For a private, proof-gated pull use `clevercon.disbursePrivate` instead.
   */
  topUp(amount: number): Promise<{ txHash: string }>;
  /** A `fetch` that transparently settles x402 402 challenges from THIS wallet. */
  readonly fetch: typeof fetch;
  /** Remaining CleverCon budget the owner still lets this agent pull. */
  getBudget(): Promise<Budget>;
  /** The underlying spender client, for anything else (disburse, limits, activity). */
  readonly clevercon: CleverConClient;
}

export function createAgentWallet(options: AgentWalletOptions): AgentWallet {
  if (!options.secretKey) throw new Error('createAgentWallet: secretKey is required');
  // Throws on a malformed secret, which is the validation we want up front.
  const address = Keypair.fromSecret(options.secretKey).publicKey();

  const clevercon = createSpender({
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const payingFetch = createPayingFetch({ secretKey: options.secretKey, network: options.network });

  // Public-lane funding: the agent's own key IS the session key, so it pulls
  // working capital by paying itself via release_payment_session (bounded on-chain).
  const sessionSpender = options.vault
    ? createSessionSpender({ ...options.vault, sessionSecret: options.secretKey })
    : null;

  return {
    address,
    clevercon,
    fetch: payingFetch,
    getBudget: () => clevercon.getBudget(),
    topUp: async (amount) => {
      if (!sessionSpender) {
        throw new Error(
          'topUp needs vault config: pass { vault: { vaultId, usdcSac } } and have the owner ' +
            'register this agent key as a session whose allowlist includes the agent address ' +
            '(registerSession). For a private pull use clevercon.disbursePrivate([{ payee: ' +
            'wallet.address, amount }]).',
        );
      }
      return sessionSpender.pay(address, amount);
    },
  };
}
