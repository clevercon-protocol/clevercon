/**
 * Managed Sessions (server + public lane) LIVE e2e against the deployed API.
 *
 * The dapp's public path: the owner authorizes a bounded scope once (wallet signs
 * register_session for their SERVER-HELD delegate = the session key), then the
 * SERVER spends hands-off within it (POST /vault/session/pay, no per-payment
 * signature), the vault enforces budget + allowlist + expiry, and revoke is
 * wallet-signed. Mirrors the 9/9 (raw) + 7/7 (SDK) on the server path.
 *
 * Run:  API_URL=https://cleverconapi-production.up.railway.app npx tsx scripts/e2e-managed-session-live.ts
 */
import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Transaction,
  Networks,
  Horizon,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.API_URL ?? 'https://cleverconapi-production.up.railway.app';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);
const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { stage: string; ok: boolean }[] = [];
function record(stage: string, ok: boolean, detail = '') {
  results.push({ stage, ok });
  console.log(`${ok ? '✓' : '✗'} ${stage}${detail ? ' - ' + detail : ''}`);
  if (!ok) throw new Error(`Stage failed: ${stage} ${detail}`);
}

async function api<T = any>(
  p: string,
  opts: { method?: string; body?: unknown; token?: string; stepup?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.stepup) headers['x-stepup'] = opts.stepup;
  const res = await fetch(`${API_URL}${p}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${p} ${res.status}: ${text.slice(0, 300)}`);
  return data as T;
}
function signXdr(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  tx.sign(kp);
  return tx.toXDR();
}
async function submitClassic(tx: Transaction): Promise<string> {
  return (await horizon.submitTransaction(tx)).hash;
}
async function usdcBalance(pk: string): Promise<number> {
  try {
    const acct = await horizon.loadAccount(pk);
    const b = acct.balances.find(
      (x: any) => x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER,
    ) as any;
    return parseFloat(b?.balance ?? '0');
  } catch {
    return 0;
  }
}
async function accountExists(pk: string): Promise<boolean> {
  try {
    await horizon.loadAccount(pk);
    return true;
  } catch {
    return false;
  }
}
/** Create-or-top-up an account's XLM from the faucet (for delegate fee funding). */
async function ensureXlm(to: string, amount: string) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const op = (await accountExists(to))
    ? Operation.payment({ destination: to, asset: Asset.native(), amount })
    : Operation.createAccount({ destination: to, startingBalance: amount });
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  await submitClassic(tx);
}
async function addTrustline(kp: Keypair) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await submitClassic(tx);
}
async function ensureFaucetUsdc(min: number) {
  const bal = await usdcBalance(faucet.publicKey());
  if (bal >= min) return;
  const need = Math.ceil(min - bal) + 2;
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: '1000', networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: String(need * 5),
        destination: faucet.publicKey(),
        destAsset: USDC,
        destAmount: String(need),
        path: [],
      }),
    )
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  await submitClassic(tx);
}
async function faucetUsdc(to: string, amount: number) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(amount) }))
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  await submitClassic(tx);
}
async function signIn(kp: Keypair): Promise<string> {
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  const tok = await api<{ accessToken: string }>('/auth/verify', {
    body: { transaction: signXdr(ch.transaction, kp) },
  });
  return tok.accessToken;
}
async function stepUp(kp: Keypair): Promise<string> {
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  return signXdr(ch.transaction, kp);
}

async function main() {
  console.log(`\nCleverCon Managed Sessions LIVE e2e  (api=${API_URL})\n`);
  const buyer = Keypair.random();
  const payee = Keypair.random();
  console.log(`buyer ${buyer.publicKey()}\npayee ${payee.publicKey()}\n`);

  // onboard
  await ensureXlm(buyer.publicKey(), '10');
  await ensureXlm(payee.publicKey(), '2');
  await addTrustline(buyer);
  await addTrustline(payee);
  await ensureFaucetUsdc(8);
  await faucetUsdc(buyer.publicKey(), 6);
  record('onboarded buyer + payee', (await usdcBalance(buyer.publicKey())) >= 6);

  const token = await signIn(buyer);
  record('SEP-10 sign-in', !!token, `jwt ${token.slice(0, 10)}…`);

  // deposit 5 USDC via the API
  {
    const su = await stepUp(buyer);
    const built = await api<{ xdr: string }>('/vault/deposit', {
      body: { amountUsdc: 5 },
      token,
      stepup: su,
    });
    await api('/vault/submit', { body: { signedXdr: signXdr(built.xdr, buyer) }, token });
    let bal = 0;
    for (let i = 0; i < 24; i++) {
      bal = (await api<{ balance: number }>('/vault', { token })).balance;
      if (bal >= 4.999) break;
      await sleep(5000);
    }
    record('deposit 5 USDC mirrored', bal >= 4.999, `vault ${bal} USDC`);
  }

  // enable Managed Sessions: wallet signs register_session for the server delegate
  const enable = await api<{ xdr: string; sessionPublicKey: string; expiry: number }>(
    '/vault/session/enable',
    { body: { budgetUsdc: 3, allowlist: [payee.publicKey()], expiresInSeconds: 3600 }, token },
  );
  await api('/vault/submit', { body: { signedXdr: signXdr(enable.xdr, buyer) }, token });
  const delegate = enable.sessionPublicKey;
  record(
    'session enabled (register_session signed)',
    !!delegate,
    `delegate ${delegate.slice(0, 6)}…`,
  );

  // confirm the on-chain scope
  {
    const s = await api<{ session: { budgetRemainingUsdc: number; allowlist: string[] } | null }>(
      '/vault/session',
      { token },
    );
    record(
      'scope readable on-chain',
      s.session?.budgetRemainingUsdc === 3 && s.session?.allowlist.includes(payee.publicKey()),
      `budget ${s.session?.budgetRemainingUsdc} USDC`,
    );
  }

  // make sure the server delegate can pay its own fee (friendbot can flake)
  await ensureXlm(delegate, '5').catch(() => {});

  // hands-off spend: the server signs release_payment_session with the delegate
  const before = await usdcBalance(payee.publicKey());
  const pay = await api<{ txHash: string }>('/vault/session/pay', {
    body: { payee: payee.publicKey(), amount: 1 },
    token,
  });
  // the payment is submitted synchronously; give Horizon a moment to reflect it
  let moved = 0;
  for (let i = 0; i < 10; i++) {
    moved = (await usdcBalance(payee.publicKey())) - before;
    if (Math.round(moved * 1e7) === 1e7) break;
    await sleep(3000);
  }
  record(
    'session/pay moved funds (server-signed)',
    Math.round(moved * 1e7) === 1e7,
    `payee +${moved.toFixed(4)} USDC, tx ${pay.txHash.slice(0, 10)}`,
  );

  // budget decremented on-chain
  {
    const s = await api<{ session: { budgetRemainingUsdc: number } | null }>('/vault/session', {
      token,
    });
    record(
      'budget decremented on-chain',
      s.session?.budgetRemainingUsdc === 2,
      `budget ${s.session?.budgetRemainingUsdc} USDC left`,
    );
  }

  // revoke: wallet signs revoke_session; the key can spend nothing after
  const rev = await api<{ xdr: string }>('/vault/session/revoke', { body: {}, token });
  await api('/vault/submit', { body: { signedXdr: signXdr(rev.xdr, buyer) }, token });
  {
    const s = await api<{ session: unknown | null }>('/vault/session', { token });
    record('revoked (scope gone on-chain)', s.session === null);
  }
  let payBlocked = false;
  try {
    await api('/vault/session/pay', { body: { payee: payee.publicKey(), amount: 1 }, token });
  } catch {
    payBlocked = true;
  }
  record('revoked session cannot spend', payBlocked);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

main().catch((e) => {
  console.error('\nFAILED:', e?.message ?? e, '\n');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} stages passed before failure.\n`);
  process.exit(1);
});
