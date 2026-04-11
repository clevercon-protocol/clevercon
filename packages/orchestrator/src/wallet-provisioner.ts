/**
 * Wallet provisioner — creates a sponsored Stellar agent account.
 *
 * Calls the Stellar Sponsored Agent Account service which:
 *  1. Creates a new Stellar account for the agent
 *  2. Sponsors the minimum XLM reserve (~1.5 XLM) so the agent pays nothing
 *  3. Sets up the USDC trustline automatically
 *
 * The secret key is generated client-side and NEVER sent to the service.
 * The service only receives the public key.
 *
 * Service: https://stellar-sponsored-agent-account.onrender.com
 * Source:  https://github.com/oceans404/stellar-sponsored-agent-account
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const SPONSOR_URL =
  process.env.SPONSOR_SERVICE_URL ||
  'https://stellar-sponsored-agent-account.onrender.com';

export interface ProvisionedWallet {
  publicKey: string;
  secretKey: string;
  explorerUrl: string;
  txHash: string;
}

export async function provisionAgentWallet(): Promise<ProvisionedWallet> {
  // 1. Generate keypair locally — secret never leaves this process
  const kp = Keypair.random();

  // 2. Ask the sponsor service to build the funding transaction
  const createRes = await fetch(`${SPONSOR_URL}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: kp.publicKey() }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Sponsor service error ${createRes.status}: ${body}`);
  }

  const { xdr, network_passphrase } = await createRes.json();

  // 3. Safety check: exactly 4 operations expected
  //    (beginSponsoring, createAccount, changeTrust, endSponsoring)
  const tx = TransactionBuilder.fromXDR(xdr, network_passphrase);
  if (tx.operations.length !== 4) {
    throw new Error(
      `Unexpected operation count: ${tx.operations.length} (expected 4). Refusing to sign.`
    );
  }

  // 4. Sign with the new keypair
  tx.sign(kp);

  // 5. Submit the signed transaction
  const submitRes = await fetch(`${SPONSOR_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xdr: tx.toXDR() }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Submit error ${submitRes.status}: ${body}`);
  }

  const result = await submitRes.json();

  return {
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
    explorerUrl:
      result.explorer_url ||
      `https://stellar.expert/explorer/testnet/account/${kp.publicKey()}`,
    txHash: result.hash || result.tx_hash || '',
  };
}
