import { signTransaction } from './wallet';

// Classic-Stellar helpers for the connected wallet: read balances and manage the
// USDC trustline. These are client-side Horizon calls (read-heavy, no custody),
// adapted from the dashboard. Stellar SDK is dynamically imported so it stays out
// of the eager bundle.
const HORIZON = 'https://horizon-testnet.stellar.org';
const USDC_CODE = 'USDC';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export const explorerAccount = (address: string): string =>
  `https://stellar.expert/explorer/testnet/account/${address}`;

export interface WalletBalances {
  funded: boolean;
  xlm: number;
  /** USDC balance, or null when no trustline exists. */
  usdc: number | null;
}

/** Read XLM and USDC balances (and trustline presence) for an address. */
export async function getWalletBalances(address: string): Promise<WalletBalances> {
  const { Horizon } = await import('@stellar/stellar-sdk');
  const server = new Horizon.Server(HORIZON);
  try {
    const acct = await server.loadAccount(address);
    const native = acct.balances.find((b) => b.asset_type === 'native');
    const usdcLine = acct.balances.find(
      (b) =>
        (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
        b.asset_code === USDC_CODE &&
        b.asset_issuer === USDC_ISSUER,
    );
    return {
      funded: true,
      xlm: native ? Number(native.balance) : 0,
      usdc: usdcLine ? Number(usdcLine.balance) : null,
    };
  } catch {
    // 404 from Horizon means the account is not funded yet.
    return { funded: false, xlm: 0, usdc: null };
  }
}

/** Build, sign (via the wallet), and submit a changeTrust(USDC) transaction. */
export async function addUsdcTrustline(address: string): Promise<void> {
  const { Horizon, TransactionBuilder, Operation, Asset, BASE_FEE } =
    await import('@stellar/stellar-sdk');
  const server = new Horizon.Server(HORIZON);
  const account = await server.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
    .setTimeout(180)
    .build();
  const signedXdr = await signTransaction(tx.toXDR(), TESTNET_PASSPHRASE);
  const signed = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  await server.submitTransaction(signed);
}
