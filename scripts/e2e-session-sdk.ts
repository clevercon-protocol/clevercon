/**
 * Session-key LIVE e2e through the PUBLISHED SDK surface (@clevercon/agent-sdk):
 * registerSession -> createSessionSpender().pay / .scope -> revokeSession, against
 * the live vault. Proves the self+public agent path end to end via the SDK, not
 * raw invokes. Onboarding (fund/trustline/deposit) is plain Stellar.
 *
 * Run:  npx tsx scripts/e2e-session-sdk.ts   (build the SDK dist first)
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
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  registerSession,
  createSessionSpender,
  revokeSession,
  SessionError,
  receipt,
} from '@clevercon/agent-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const VAULT = 'CDVMPHPD3V6KNVS2ORBQD6A6FSWDCHN7RK2LW4C2KUPHZLM5H3KNKK6A';
const PASSPHRASE = Networks.TESTNET;
const UNIT = 10_000_000;
const net = { vaultId: VAULT, usdcSac: USDC_SAC, rpcUrl: SOROBAN_RPC };

const horizon = new Horizon.Server(HORIZON_URL);
const server = new rpc.Server(SOROBAN_RPC);
const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { stage: string; ok: boolean }[] = [];
function record(stage: string, ok: boolean, detail = '') {
  results.push({ stage, ok });
  console.log(`${ok ? '✓' : '✗'} ${stage}${detail ? ' - ' + detail : ''}`);
  if (!ok) throw new Error(`Stage failed: ${stage}`);
}
async function usdcBalance(pk: string): Promise<number> {
  try {
    const a = await horizon.loadAccount(pk);
    const b = a.balances.find(
      (x: any) => x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER,
    );
    return b ? Number(b.balance) : 0;
  } catch {
    return 0;
  }
}
async function classic(ops: xdr.Operation[], signer: Keypair) {
  const acct = await horizon.loadAccount(signer.publicKey());
  const b = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(60).build();
  tx.sign(signer);
  await horizon.submitTransaction(tx);
}
async function ensureFaucetUsdc(min: number) {
  if ((await usdcBalance(faucet.publicKey())) >= min) return;
  const need = Math.ceil(min) + 2;
  await classic(
    [
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: String(need * 5),
        destination: faucet.publicKey(),
        destAsset: USDC,
        destAmount: String(need),
        path: [],
      }),
    ],
    faucet,
  );
}
async function depositRaw(buyer: Keypair, amountUsdc: number) {
  const account = await server.getAccount(buyer.publicKey());
  const tx = new TransactionBuilder(account, { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(VAULT).call(
        'deposit',
        new Address(buyer.publicKey()).toScVal(),
        new Address(USDC_SAC).toScVal(),
        nativeToScVal(BigInt(amountUsdc * UNIT), { type: 'i128' }),
      ),
    )
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(buyer);
  const sent = await server.sendTransaction(prepared);
  let got = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && got.status === 'NOT_FOUND'; i++) {
    await sleep(2000);
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== 'SUCCESS') throw new Error(`deposit ${got.status}`);
}

async function main() {
  console.log(`\nCleverCon session-key SDK e2e  (vault=${VAULT})\n`);
  const buyer = Keypair.random();
  const session = Keypair.random();
  const payee = Keypair.random();
  console.log(
    `buyer ${buyer.publicKey()}\nsession ${session.publicKey()}\npayee ${payee.publicKey()}\n`,
  );

  await classic(
    [Operation.createAccount({ destination: buyer.publicKey(), startingBalance: '10' })],
    faucet,
  );
  await classic(
    [Operation.createAccount({ destination: session.publicKey(), startingBalance: '5' })],
    faucet,
  );
  await classic(
    [Operation.createAccount({ destination: payee.publicKey(), startingBalance: '2' })],
    faucet,
  );
  await classic([Operation.changeTrust({ asset: USDC })], buyer);
  await classic([Operation.changeTrust({ asset: USDC })], payee);
  record('onboarded (XLM + trustlines)', true);

  await ensureFaucetUsdc(8);
  await classic(
    [Operation.payment({ destination: buyer.publicKey(), asset: USDC, amount: '6' })],
    faucet,
  );
  record('faucet USDC', (await usdcBalance(buyer.publicKey())) >= 6);

  await depositRaw(buyer, 5);
  record('deposit 5 USDC', true);

  // ── SDK surface ──
  const reg = await registerSession({
    ...net,
    ownerSecret: buyer.secret(),
    sessionSecret: session.secret(),
    budgetUsdc: 3,
    allowlist: [payee.publicKey()],
    expiresInSeconds: 3600,
  });
  record(
    'SDK registerSession',
    reg.sessionPublicKey === session.publicKey(),
    `budget ${reg.budgetUsdc} USDC`,
  );

  const spender = createSessionSpender({ ...net, sessionSecret: reg.sessionSecret });
  const before = await usdcBalance(payee.publicKey());
  const paid = await spender.pay(payee.publicKey(), 1);
  const after = await usdcBalance(payee.publicKey());
  record(
    'SDK sessionSpender.pay moved funds',
    Math.round((after - before) * UNIT) === UNIT,
    `payee +${(after - before).toFixed(4)} USDC`,
  );

  // receipt(): decode the on-chain authorizer of that payment.
  const r = await receipt({ txHash: paid.txHash, rpcUrl: SOROBAN_RPC });
  record(
    'receipt() shows the session key authorized it',
    r.authorizer.lane === 'public' &&
      r.authorizer.kind === 'session-key' &&
      r.authorizer.sessionKey === session.publicKey() &&
      r.payees[0] === payee.publicKey() &&
      r.amountsUsdc[0] === 1,
    `lane=${r.authorizer.lane} via ${r.authorizer.kind}`,
  );

  const scope = await spender.scope();
  record(
    'SDK scope() budget decremented',
    scope.budgetRemainingUsdc === 2,
    `budget ${scope.budgetRemainingUsdc} USDC left`,
  );

  await revokeSession({
    ...net,
    ownerSecret: buyer.secret(),
    sessionPublicKey: session.publicKey(),
  });
  let dead = false;
  try {
    await spender.pay(payee.publicKey(), 1);
  } catch (e) {
    dead = e instanceof SessionError;
  }
  record('SDK revokeSession kills the key', dead);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

main().catch((e) => {
  console.error('\nFAILED:', e?.message ?? e, '\n');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} stages passed before failure.\n`);
  process.exit(1);
});
