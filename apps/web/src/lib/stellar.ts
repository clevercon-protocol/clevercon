import { signTransaction } from './wallet';

// Classic-Stellar helpers for the connected wallet: read balances and manage the
// USDC trustline. These are client-side Horizon calls (read-heavy, no custody),
// adapted from the dashboard. Stellar SDK is dynamically imported so it stays out
// of the eager bundle.
import { HORIZON_URL, USDC_ISSUER, NETWORK_PASSPHRASE, NETWORK } from './network';

const USDC_CODE = 'USDC';

export { explorerAccount } from './network';

/**
 * Create + fund the account with testnet XLM via Friendbot. Testnet only (there
 * is no Friendbot on mainnet). Idempotent-ish: a second call on a funded account
 * just tops it up / no-ops. Throws on a non-OK response.
 */
export async function fundWithFriendbot(address: string): Promise<void> {
  if (NETWORK === 'mainnet') {
    throw new Error('Friendbot is testnet-only; fund this wallet with real XLM.');
  }
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    // Friendbot returns 400 "op_already_exists" when the account is already funded.
    const body = await res.text().catch(() => '');
    if (/already|op_already_exists|createAccountAlreadyExist/i.test(body)) return;
    throw new Error('Friendbot could not fund this account. Try again in a moment.');
  }
}

export interface WalletBalances {
  funded: boolean;
  xlm: number;
  /** USDC balance, or null when no trustline exists. */
  usdc: number | null;
}

/** Read XLM and USDC balances (and trustline presence) for an address. */
export async function getWalletBalances(address: string): Promise<WalletBalances> {
  const { Horizon } = await import('@stellar/stellar-sdk');
  const server = new Horizon.Server(HORIZON_URL);
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
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
    .setTimeout(180)
    .build();
  const signedXdr = await signTransaction(tx.toXDR(), NETWORK_PASSPHRASE);
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  await server.submitTransaction(signed);
}

/**
 * Swap some of the wallet's XLM for `destUsdc` USDC on the DEX (a wallet-signed
 * strict-receive path payment to self). Testers fund XLM with Friendbot for free,
 * then mint their own test USDC this way - no operator faucet, no shared source
 * wallet. Needs the USDC trustline first. Throws when there is no liquidity/path,
 * so callers can fall back to a hosted faucet link.
 */
export async function swapXlmForUsdc(address: string, destUsdc: number): Promise<void> {
  const { Horizon, TransactionBuilder, Operation, Asset, BASE_FEE } =
    await import('@stellar/stellar-sdk');
  const server = new Horizon.Server(HORIZON_URL);
  const usdc = new Asset(USDC_CODE, USDC_ISSUER);
  const destAmount = destUsdc.toFixed(7);

  // Find the cheapest XLM->USDC path and size sendMax off it (with slippage
  // headroom); fall back to a direct single-hop with a generous cap. The user
  // only ever pays the real cost up to sendMax, so a loose cap is safe.
  let path: InstanceType<typeof Asset>[] = [];
  let sendMax = (destUsdc * 10).toFixed(7);
  try {
    const paths = await server.strictReceivePaths([Asset.native()], usdc, destAmount).call();
    const best = paths.records?.[0];
    if (best) {
      path = (best.path ?? []).map((p) =>
        p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
      );
      sendMax = (Number(best.source_amount) * 1.5).toFixed(7);
    }
  } catch {
    // fall through to the direct-path defaults
  }

  const account = await server.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 10),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination: address,
        destAsset: usdc,
        destAmount,
        path,
      }),
    )
    .setTimeout(120)
    .build();
  const signedXdr = await signTransaction(tx.toXDR(), NETWORK_PASSPHRASE);
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  await server.submitTransaction(signed);
}
