/**
 * CleverCon headless testnet E2E harness (T0 of TESTNET-COMPLETION-PLAN).
 *
 * Drives the full money loop on Stellar testnet with a FRESH throwaway keypair
 * and NO browser: friendbot fund -> USDC trustline -> faucet USDC -> SEP-10
 * sign-in -> vault deposit (step-up signed) -> authorize delegate -> create a
 * policy -> [pay / disburse once T1 lands] -> hire (best-effort) -> withdraw ->
 * reclaim leftover USDC to the faucet. Every wallet signature is produced here
 * with the raw keypair, so this proves the flows the sandbox could never click.
 *
 * The orchestrator wallet (wallets.json) is the USDC faucet; it tops itself up
 * by swapping XLM->USDC on the testnet DEX when low, so runs are repeatable.
 *
 * Run:  npx tsx scripts/e2e-testnet.ts
 * Env:  API_URL (default http://localhost:4100), E2E_DEPOSIT (default 3),
 *       E2E_SKIP_HIRE=1 to skip the provider-dependent hire stage.
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
import http from 'node:http';
import { createHmac } from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSpender } from '@clevercon/agent-sdk/spender';
import { createAgentWallet } from '@clevercon/agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme as X402ServerScheme } from '@x402/stellar/exact/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL ?? 'http://localhost:4100';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const PASSPHRASE = Networks.TESTNET;
const DEPOSIT = Number(process.env.E2E_DEPOSIT ?? '5');
const FAUCET_SEND = DEPOSIT + 2; // send a little more than we deposit
const horizon = new Horizon.Server(HORIZON_URL);

// x402 (T4): the exact scheme settles in the SAME testnet USDC the vault dispenses
// (CBIELTK6 / issuer GBBD47IF), through the public facilitator (fees sponsored).
const X402_NETWORK = 'stellar:testnet' as `${string}:${string}`;
const X402_FACILITATOR = process.env.X402_FACILITATOR_URL ?? 'https://www.x402.org/facilitator';
const X402_PORT = 4610;
const X402_PRICE = 0.02;

const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);

// ── Small helpers ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { stage: string; ok: boolean; detail: string }[] = [];
function record(stage: string, ok: boolean, detail = '') {
  results.push({ stage, ok, detail });
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

/** Sign any base64 tx XDR (classic or Soroban) with a keypair and re-encode. */
function signXdr(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  tx.sign(kp);
  return tx.toXDR();
}

async function submitClassic(tx: Transaction): Promise<string> {
  const res = await horizon.submitTransaction(tx);
  return res.hash;
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

// ── Faucet: keep it stocked by swapping XLM->USDC on the DEX ───────────────────
async function ensureFaucetUsdc(min: number) {
  const bal = await usdcBalance(faucet.publicKey());
  if (bal >= min) return;
  const need = Math.ceil(min - bal) + 2;
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: '1000', networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: String(need * 5), // generous XLM cap; testnet DEX price varies
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

async function faucetSend(to: string, amount: number) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(amount) }))
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  return submitClassic(tx);
}

// ── SEP-10 sign-in ─────────────────────────────────────────────────────────────
async function signIn(kp: Keypair): Promise<string> {
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  const signed = signXdr(ch.transaction, kp);
  const tok = await api<{ accessToken: string }>('/auth/verify', { body: { transaction: signed } });
  return tok.accessToken;
}

async function stepUp(kp: Keypair): Promise<string> {
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  return signXdr(ch.transaction, kp);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nCleverCon testnet E2E  (api=${API_URL}, deposit=${DEPOSIT} USDC)\n`);
  const buyer = Keypair.random();
  console.log(`buyer: ${buyer.publicKey()}`);
  console.log(`buyer secret (throwaway): ${buyer.secret()}\n`);

  // 1. friendbot fund (XLM)
  const fb = await fetch(`${FRIENDBOT}?addr=${buyer.publicKey()}`);
  record('friendbot fund', fb.ok, `${fb.status}`);
  await sleep(2000);

  // 2. USDC trustline (buyer-signed)
  {
    const acct = await horizon.loadAccount(buyer.publicKey());
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(buyer);
    const h = await submitClassic(tx);
    record('USDC trustline', true, h.slice(0, 10));
  }

  // 3. faucet USDC -> buyer
  await ensureFaucetUsdc(FAUCET_SEND + 1);
  const fh = await faucetSend(buyer.publicKey(), FAUCET_SEND);
  const startUsdc = await usdcBalance(buyer.publicKey());
  record('faucet USDC', startUsdc >= FAUCET_SEND - 0.001, `buyer has ${startUsdc} USDC, tx ${fh.slice(0, 10)}`);

  // 4. SEP-10 sign-in
  const token = await signIn(buyer);
  record('SEP-10 sign-in', !!token, `jwt ${token.slice(0, 12)}…`);

  // 5. deposit (step-up signed Soroban invoke)
  {
    const su = await stepUp(buyer);
    const built = await api<{ xdr: string }>('/vault/deposit', {
      body: { amountUsdc: DEPOSIT },
      token,
      stepup: su,
    });
    const signed = signXdr(built.xdr, buyer);
    const sub = await api<{ txHash: string }>('/vault/submit', { body: { signedXdr: signed }, token });
    record('vault deposit (submit)', !!sub.txHash, sub.txHash.slice(0, 10));
  }

  // 5b. wait for the indexer mirror to reflect the deposit
  {
    let mirrored = 0;
    for (let i = 0; i < 24; i++) {
      const v = await api<{ balance: number; available: number }>('/vault', { token });
      mirrored = v.balance;
      if (v.balance >= DEPOSIT - 0.001) break;
      await sleep(5000);
    }
    record('vault mirror reflects deposit', mirrored >= DEPOSIT - 0.001, `balance ${mirrored} USDC`);
  }

  // 6. authorize delegate (register_orchestrator, buyer-signed once)
  {
    const built = await api<{ xdr: string }>('/vault/delegate/register', { body: {}, token });
    const signed = signXdr(built.xdr, buyer);
    await api('/vault/submit', { body: { signedXdr: signed }, token });
    await api('/vault/delegate/confirm', { body: {}, token });
    const d = await api<{ registered: boolean }>('/vault/delegate', { token });
    record('authorize delegate', d.registered, 'registered');
  }

  // 7. create a policy (transparent so we can assert; caps cover our amounts)
  let policyId = '';
  {
    const p = await api<{ id: string; commitment: string }>('/policies', {
      body: {
        rules: { perPaymentCeilingUsdc: DEPOSIT, rollingCapUsdc: DEPOSIT * 3, rollingWindowSecs: 86400 },
        isPrivate: false,
      },
      token,
    });
    policyId = p.id;
    record('create policy', !!policyId, `commitment ${p.commitment.slice(0, 10)}…`);
  }

  // 7b. Register a local webhook sink so spend completions notify it (integrations).
  const sink = startWebhookSink();
  let webhookSecret = '';
  {
    const wh = await api<{ id: string; secret: string }>('/webhooks', {
      body: { url: sink.url, events: [] },
      token,
    });
    webhookSecret = wh.secret;
    record('register webhook', !!wh.id, sink.url);
  }

  // 8. PAY / DISBURSE (T1): the core spend primitive, real releases on-chain.
  const payTaskId = await runPayStage(token, policyId, buyer);

  // 8b. The pay task completing should have notified the webhook (pay/disburse
  // finalize in the settlement worker, which now delivers the terminal event).
  await runWebhookStage(sink, webhookSecret, payTaskId);

  // 8c. Concurrency: fire two payments at once for the SAME delegate. This used
  // to collide on the signer's sequence number (one would fail); the per-key
  // mutex + txBadSeq retry must now settle both.
  await runConcurrentStage(token, policyId);

  // 9. hire (best-effort; depends on a live provider endpoint)
  if (process.env.E2E_SKIP_HIRE !== '1') {
    await runHireStage(token, policyId).catch((e) =>
      console.log(`  (hire stage warn: ${e.message})`),
    );
  }

  // 9b. the other two doors: the spender SDK and the MCP, driven with an API key.
  const apiKey = await runReachStage(token, policyId, buyer);

  // 9c. x402 agent-key mode (T4): vault -> agent wallet -> external x402 service.
  if (process.env.E2E_SKIP_X402 !== '1') {
    await runX402Stage(token, apiKey, policyId).catch((e) =>
      console.log(`  (x402 stage warn: ${e.message})`),
    );
  }

  // 10. withdraw available back to the buyer wallet.
  //     First wait for the mirror to reflect on-chain finalization (locked -> ~0
  //     once complete_task unlocked the hire's remaining budget), so `available`
  //     is accurate and withdraw is not rejected with InsufficientAvailable.
  {
    let locked = 1;
    for (let i = 0; i < 18; i++) {
      const v = await api<{ locked: number }>('/vault', { token });
      locked = v.locked;
      if (v.locked <= 0.001) break;
      await sleep(5000);
    }
    const v = await api<{ available: number }>('/vault', { token });
    const amt = Math.max(0, Math.floor(v.available * 100) / 100 - 0.01);
    if (amt > 0) {
      const su = await stepUp(buyer);
      const built = await api<{ xdr: string }>('/vault/withdraw', {
        body: { amountUsdc: amt },
        token,
        stepup: su,
      });
      const signed = signXdr(built.xdr, buyer);
      const sub = await api<{ txHash: string }>('/vault/submit', {
        body: { signedXdr: signed },
        token,
      });
      record('vault withdraw', !!sub.txHash, `${amt} USDC, tx ${sub.txHash.slice(0, 10)}`);
    } else {
      record('vault withdraw', true, 'nothing available to withdraw (all spent)');
    }
  }

  // 11. reclaim leftover USDC to the faucet so runs stay repeatable
  {
    await sleep(3000);
    const bal = await usdcBalance(buyer.publicKey());
    if (bal > 0.01) {
      const acct = await horizon.loadAccount(buyer.publicKey());
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
        .addOperation(
          Operation.payment({
            destination: faucet.publicKey(),
            asset: USDC,
            amount: bal.toFixed(7),
          }),
        )
        .setTimeout(60)
        .build();
      tx.sign(buyer);
      await submitClassic(tx);
    }
    record('reclaim USDC to faucet', true, `${bal.toFixed(2)} USDC returned`);
  }

  sink.close();

  // Summary
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

// ── T1 stage: pay + disburse via the /payments primitive ──────────────────────
async function waitTaskComplete(token: string, taskId: string, label: string) {
  let status = '';
  let spent = 0;
  for (let i = 0; i < 30; i++) {
    const t = await api<{ status: string; spent: number; budget: number }>(`/tasks/${taskId}`, {
      token,
    });
    status = t.status;
    spent = t.spent;
    if (t.status === 'COMPLETED' && t.spent >= t.budget - 0.001) break;
    if (['FAILED', 'CANCELLED'].includes(t.status)) break;
    await sleep(5000);
  }
  record(
    `${label} settle`,
    status === 'COMPLETED' && spent > 0,
    `task ${taskId.slice(0, 8)} status ${status} spent ${spent}`,
  );
}

async function runConcurrentStage(token: string, policyId: string) {
  const pay = (amount: number) =>
    api<{ id: string }>('/payments', {
      body: {
        kind: 'pay',
        lines: [{ payee: faucet.publicKey(), amount, reason: 'concurrent' }],
        policyId,
      },
      token,
    });
  // Two locks submitted at the same instant, same signer.
  const [a, b] = await Promise.all([pay(0.2), pay(0.2)]);
  await Promise.all([
    waitTaskComplete(token, a.id, 'concurrent pay A'),
    waitTaskComplete(token, b.id, 'concurrent pay B'),
  ]);
}

async function runPayStage(token: string, policyId: string, buyer: Keypair): Promise<string> {
  // pay: one line to the faucet (it has a USDC trustline to receive).
  const pay = await api<{ id: string }>('/payments', {
    body: {
      kind: 'pay',
      lines: [{ payee: faucet.publicKey(), amount: 0.5, reason: 'e2e pay' }],
      policyId,
    },
    token,
  });
  await waitTaskComplete(token, pay.id, 'pay');

  // disburse: two lines, varying amounts, distinct payees (faucet + buyer wallet).
  const dis = await api<{ id: string }>('/payments', {
    body: {
      kind: 'disburse',
      lines: [
        { payee: faucet.publicKey(), amount: 0.4, reason: 'vendor A' },
        { payee: buyer.publicKey(), amount: 0.6, reason: 'vendor B' },
      ],
      policyId,
    },
    token,
  });
  await waitTaskComplete(token, dis.id, 'disburse');
  return pay.id;
}

// ── Webhook stage: prove a pay/disburse completion notifies registered webhooks ──
interface HookHit {
  event: string;
  signature: string;
  rawBody: string;
  body: { data?: { taskId?: string; status?: string } } | null;
}

function startWebhookSink(): { url: string; received: HookHit[]; close: () => void } {
  const received: HookHit[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      received.push({
        event: String(req.headers['x-clevercon-event'] ?? ''),
        signature: String(req.headers['x-clevercon-signature'] ?? ''),
        rawBody: data,
        body: (() => {
          try {
            return JSON.parse(data);
          } catch {
            return null;
          }
        })(),
      });
      res.writeHead(200);
      res.end('ok');
    });
  });
  server.listen(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/hook`, received, close: () => server.close() };
}

/** Poll the sink for a signed task.completed matching the pay task. */
async function runWebhookStage(sink: ReturnType<typeof startWebhookSink>, secret: string, payId: string) {
  let hit: HookHit | undefined;
  for (let i = 0; i < 12; i++) {
    hit = sink.received.find((h) => h.event === 'task.completed' && h.body?.data?.taskId === payId);
    if (hit) break;
    await sleep(2000);
  }
  const sigOk =
    !!hit && createHmac('sha256', secret).update(hit.rawBody).digest('hex') === hit.signature;
  record(
    'webhook task.completed (pay)',
    !!hit && sigOk,
    hit ? `delivered, signature ${sigOk ? 'valid' : 'INVALID'}` : 'not received',
  );
}

// ── Reach stage: the spender SDK + the MCP, both driven with a scoped API key ──
async function waitVaultIdle(token: string) {
  for (let i = 0; i < 24; i++) {
    const v = await api<{ locked: number }>('/vault', { token });
    if (v.locked <= 0.001) return;
    await sleep(5000);
  }
}

async function runReachStage(token: string, policyId: string, buyer: Keypair) {
  // Mint a scoped key (JWT-guarded), then use it exactly as an external agent would.
  const keyRes = await api<{ key: string }>('/api-keys', {
    body: { name: 'e2e-reach', quotaPerDay: 0 },
    token,
  });
  const apiKey = keyRes.key;
  record('mint API key', !!apiKey, `${apiKey.slice(0, 10)}…`);

  // Wait until the delegate is free (prior spends fully finalized on-chain).
  // All of a user's releases and locks share one delegate signer, so overlapping
  // spends contend on its sequence number (the sequence-manager scale item).
  await waitVaultIdle(token);

  // SDK: read the budget and make a real bounded payment via createSpender.
  const cc = createSpender({ apiKey, apiUrl: API_URL });
  const budget = await cc.getBudget();
  record('SDK get_budget', budget.available > 0, `available ${budget.available} USDC`);
  const spend = await cc.pay(faucet.publicKey(), 0.3, { reason: 'sdk pay', policyId });
  await waitTaskComplete(token, spend.id, 'SDK pay');

  // MCP: spawn the server over stdio, confirm the money verbs are exposed, and
  // read the budget through it (proves the MCP -> API key path end to end).
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', path.join(__dirname, '..', 'packages', 'mcp', 'src', 'server.ts')],
    env: { ...process.env, CLEVERCON_API_URL: API_URL, CLEVERCON_API_KEY: apiKey } as Record<
      string,
      string
    >,
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((t) => t.name));
    const wanted = ['pay', 'disburse', 'set_limit', 'get_budget', 'get_activity', 'list_limits'];
    record('MCP exposes money verbs', wanted.every((n) => names.has(n)), `${names.size} tools`);
    const res = (await client.callTool({ name: 'get_budget', arguments: {} })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(res.content[0].text);
    record('MCP get_budget', typeof parsed.balance === 'number', `balance ${parsed.balance}`);
  } finally {
    await client.close().catch(() => {});
  }
  void buyer;
  return apiKey;
}

// ── T4 stage: x402 agent-key mode ─────────────────────────────────────────────
// The agent pulls working capital from the vault into its OWN wallet (governed,
// non-custodial), then pays an external x402 service with those funds through the
// public facilitator. Proves the two economies compose on one USDC.
async function addUsdcTrustline(kp: Keypair) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await submitClassic(tx);
}

async function runX402Stage(token: string, apiKey: string, policyId: string) {
  const agentKp = Keypair.random(); // the agent's OWN hot wallet (non-custodial)
  const serviceKp = Keypair.random(); // the paid x402 service's payTo
  await Promise.all([
    fetch(`${FRIENDBOT}?addr=${agentKp.publicKey()}`),
    fetch(`${FRIENDBOT}?addr=${serviceKp.publicKey()}`),
  ]);
  await sleep(2500);
  await addUsdcTrustline(agentKp); // so the vault release can land
  await addUsdcTrustline(serviceKp); // so the service can receive the x402 payment

  // Agent-key mode: one object uniting governed top-up + autonomous x402 spend.
  const wallet = createAgentWallet({ apiKey, apiUrl: API_URL, secretKey: agentKp.secret() });

  // Leg 1: pull budget from the vault into the agent wallet (settles on-chain).
  await waitVaultIdle(token); // shared delegate signer
  const before = await usdcBalance(agentKp.publicKey());
  const topup = await wallet.topUp(0.1, { policyId, reason: 'e2e agent top-up' });
  await waitTaskComplete(token, topup.id, 'x402 top-up');
  await sleep(5000);
  const funded = await usdcBalance(agentKp.publicKey());
  record(
    'agent wallet funded from vault',
    funded - before >= 0.099,
    `+${(funded - before).toFixed(3)} USDC (non-custodial, policy-bound)`,
  );

  // Leg 2: the agent pays an external x402 service with those funds.
  const facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    X402_NETWORK,
    new X402ServerScheme(),
  );
  const app = express();
  app.use(express.json());
  app.use(
    paymentMiddleware(
      {
        'POST /query': {
          accepts: {
            scheme: 'exact',
            price: `$${X402_PRICE}`,
            network: X402_NETWORK,
            payTo: serviceKp.publicKey(),
          },
          description: 'e2e paid data',
        },
      },
      resourceServer,
      undefined,
      undefined,
      true,
    ),
  );
  app.post('/query', (_req, res) => res.json({ result: { price: 'XLM-USD 0.11' } }));
  const server = app.listen(X402_PORT);
  await new Promise((r) => server.on('listening', r));
  try {
    const svcBefore = await usdcBalance(serviceKp.publicKey());
    const resp = await wallet.fetch(`http://localhost:${X402_PORT}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'xlm price' }),
    });
    await sleep(6000);
    const svcAfter = await usdcBalance(serviceKp.publicKey());
    record(
      'agent pays x402 service',
      resp.status === 200 && svcAfter - svcBefore >= X402_PRICE - 0.0001,
      `status ${resp.status}, service +${(svcAfter - svcBefore).toFixed(3)} USDC`,
    );
  } finally {
    server.close();
  }

  // Return the agent + service USDC dust to the faucet so runs stay repeatable.
  for (const kp of [agentKp, serviceKp]) {
    const bal = await usdcBalance(kp.publicKey());
    if (bal > 0.001) {
      const acct = await horizon.loadAccount(kp.publicKey());
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
        .addOperation(
          Operation.payment({ destination: faucet.publicKey(), asset: USDC, amount: bal.toFixed(7) }),
        )
        .setTimeout(60)
        .build();
      tx.sign(kp);
      await submitClassic(tx).catch(() => {});
    }
  }
}

// ── Hire stage: create a task against a live service and wait for settle ───────
async function runHireStage(token: string, policyId: string) {
  const list = await api<{ items: any[] }>('/services?limit=20', { token });
  const svc = (list.items || []).find((s) => s.pricePerCall && s.pricePerCall <= 1);
  if (!svc) throw new Error('no affordable service to hire');
  const task = await api<{ id: string }>('/tasks', {
    body: { title: 'e2e hire', mode: 'DIRECT', budget: 1, serviceId: svc.id, policyId },
    token,
  });
  let status = '';
  for (let i = 0; i < 24; i++) {
    const t = await api<{ status: string; spent: number }>(`/tasks/${task.id}`, { token });
    status = t.status;
    if (t.spent > 0 || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status)) break;
    await sleep(5000);
  }
  record('hire settle', status === 'COMPLETED', `task ${task.id.slice(0, 8)} status ${status}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}\n`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} stages passed before failure.`);
  process.exit(1);
});
