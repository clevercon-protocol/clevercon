/**
 * CleverCon session-key (Fast / public lane) LIVE e2e, Soroban-direct.
 *
 * Proves the B2 session primitive on the live vault end to end, the way the
 * self+public agent path uses it (no API, no proof): a user authorizes a bounded
 * session key (budget + payee allowlist + expiry), the SESSION KEY itself signs a
 * release to an allowlisted payee, funds move, the on-chain budget decrements, a
 * non-allowlisted payee is rejected, and a revoked key can spend nothing.
 *
 * Run:  npx tsx scripts/e2e-session-live.ts
 */
import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  Horizon,
  BASE_FEE,
  rpc,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const USDC_SAC = process.env.USDC_SAC ?? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const VAULT =
  process.env.AGENT_VAULT_CONTRACT_ID ?? 'CDVMPHPD3V6KNVS2ORBQD6A6FSWDCHN7RK2LW4C2KUPHZLM5H3KNKK6A';
const PASSPHRASE = Networks.TESTNET;

const horizon = new Horizon.Server(HORIZON_URL);
const server = new rpc.Server(SOROBAN_RPC);
const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);

const UNIT = 10_000_000; // 1 USDC in stroops (7 decimals)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { stage: string; ok: boolean; detail: string }[] = [];
function record(stage: string, ok: boolean, detail = '') {
  results.push({ stage, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${stage}${detail ? ' - ' + detail : ''}`);
  if (!ok) throw new Error(`Stage failed: ${stage} ${detail}`);
}

// ── classic helpers (fund / trustline / usdc) ───────────────────────────────
async function usdcBalance(pk: string): Promise<number> {
  try {
    const acct = await horizon.loadAccount(pk);
    const b = acct.balances.find(
      (x: any) => x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER,
    );
    return b ? Number(b.balance) : 0;
  } catch {
    return 0;
  }
}
async function fundXlm(to: string, amount: string) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.createAccount({ destination: to, startingBalance: amount }))
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  await horizon.submitTransaction(tx);
}
async function addTrustline(kp: Keypair) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
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
  await horizon.submitTransaction(tx);
}
async function faucetUsdc(to: string, amount: string) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount }))
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  await horizon.submitTransaction(tx);
}

// ── Soroban helpers ──────────────────────────────────────────────────────────
const addr = (pk: string) => new Address(pk).toScVal();
const i128 = (v: number) => nativeToScVal(BigInt(v), { type: 'i128' });
const u64 = (v: number) => nativeToScVal(BigInt(v), { type: 'u64' });
const addrVec = (pks: string[]) => xdr.ScVal.scvVec(pks.map((p) => addr(p)));

/** Build, simulate/assemble, sign (source + extra), submit, poll. Returns the
 *  decoded return value. Throws on a failed simulation or tx (so negative cases
 *  are asserted by catching). */
async function invoke(source: Keypair, method: string, args: xdr.ScVal[]): Promise<unknown> {
  const acct = await server.getAccount(source.publicKey());
  const built = new TransactionBuilder(acct, { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(VAULT).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(built); // throws on contract error at sim
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`send ERROR: ${JSON.stringify(sent.errorResult ?? {})}`);
  }
  let got = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && got.status === 'NOT_FOUND'; i++) {
    await sleep(2000);
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== 'SUCCESS') throw new Error(`tx ${got.status}`);
  return got.returnValue ? scValToNative(got.returnValue) : null;
}

/** Read-only simulate (no funds, no state change). */
async function read(method: string, args: xdr.ScVal[]): Promise<any> {
  const acct = await server.getAccount(faucet.publicKey());
  const built = new TransactionBuilder(acct, { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(VAULT).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`sim error: ${sim.error}`);
  return scValToNative(sim.result!.retval);
}

async function main() {
  console.log(`\nCleverCon session-key LIVE e2e  (vault=${VAULT})\n`);

  const buyer = Keypair.random();
  const session = Keypair.random();
  const payee = Keypair.random();
  const stranger = Keypair.random();
  console.log(`buyer   ${buyer.publicKey()}`);
  console.log(`session ${session.publicKey()}`);
  console.log(`payee   ${payee.publicKey()}\n`);

  // 0. onboard. The session key is funded with XLM so it can be the tx source for
  //    its own release (the self+public model: a persistent agent holds + pays).
  await fundXlm(buyer.publicKey(), '10');
  await fundXlm(session.publicKey(), '5');
  await fundXlm(payee.publicKey(), '2');
  record('accounts funded (XLM)', true);
  await addTrustline(buyer);
  await addTrustline(payee); // payee needs a trustline to receive the USDC release
  record('USDC trustlines', true);
  await ensureFaucetUsdc(8); // top the faucet up from the DEX (XLM -> USDC) if needed
  await faucetUsdc(buyer.publicKey(), '6');
  record('faucet USDC', (await usdcBalance(buyer.publicKey())) >= 6, 'buyer has 6 USDC');

  // 1. deposit 5 USDC into the vault (buyer signs; covers the token transfer auth).
  await invoke(buyer, 'deposit', [addr(buyer.publicKey()), addr(USDC_SAC), i128(5 * UNIT)]);
  const vbal = (await read('get_balance', [addr(buyer.publicKey()), addr(USDC_SAC)])) as bigint;
  record('deposit', vbal === BigInt(5 * UNIT), `vault balance ${Number(vbal) / UNIT} USDC`);

  // 2. register a bounded session: budget 3 USDC, allowlist [payee], expiry +1h.
  const now = Math.floor(Date.now() / 1000);
  await invoke(buyer, 'register_session', [
    addr(buyer.publicKey()),
    addr(session.publicKey()),
    addr(USDC_SAC),
    i128(3 * UNIT),
    u64(now + 3600),
    addrVec([payee.publicKey()]),
  ]);
  const s0 = await read('get_session', [addr(session.publicKey())]);
  record(
    'session registered',
    s0.budget_remaining === BigInt(3 * UNIT) && s0.user === buyer.publicKey(),
    `budget ${Number(s0.budget_remaining) / UNIT} USDC`,
  );

  // 3. the SESSION KEY signs a release to the allowlisted payee (no proof).
  const payeeBefore = await usdcBalance(payee.publicKey());
  await invoke(session, 'release_payment_session', [
    addr(session.publicKey()),
    addr(payee.publicKey()),
    i128(1 * UNIT),
  ]);
  const payeeAfter = await usdcBalance(payee.publicKey());
  record(
    'session release moved funds',
    Math.round((payeeAfter - payeeBefore) * UNIT) === 1 * UNIT,
    `payee +${(payeeAfter - payeeBefore).toFixed(4)} USDC`,
  );

  // 4. the on-chain budget decremented (cumulative scope, enforced by the vault).
  const s1 = await read('get_session', [addr(session.publicKey())]);
  record(
    'budget decremented on-chain',
    s1.budget_remaining === BigInt(2 * UNIT),
    `budget ${Number(s1.budget_remaining) / UNIT} USDC left`,
  );

  // 5. a non-allowlisted payee is rejected (scope enforced on-chain).
  let blocked = false;
  try {
    await invoke(session, 'release_payment_session', [
      addr(session.publicKey()),
      addr(stranger.publicKey()),
      i128(1 * UNIT),
    ]);
  } catch {
    blocked = true;
  }
  record('non-allowlisted payee blocked', blocked);

  // 6. revoke instantly; the key can spend nothing afterward.
  await invoke(buyer, 'revoke_session', [addr(buyer.publicKey()), addr(session.publicKey())]);
  let deadAfterRevoke = false;
  try {
    await invoke(session, 'release_payment_session', [
      addr(session.publicKey()),
      addr(payee.publicKey()),
      i128(1 * UNIT),
    ]);
  } catch {
    deadAfterRevoke = true;
  }
  record('revoked session cannot spend', deadAfterRevoke);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

main().catch((e) => {
  console.error('\nFAILED:', e?.message ?? e, '\n');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} stages passed before failure.\n`);
  process.exit(1);
});
