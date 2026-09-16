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
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL ?? 'http://localhost:4100';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const PASSPHRASE = Networks.TESTNET;
const DEPOSIT = Number(process.env.E2E_DEPOSIT ?? '3');
const FAUCET_SEND = DEPOSIT + 1; // send a little more than we deposit
const horizon = new Horizon.Server(HORIZON_URL);

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

  // 8. PAY / DISBURSE (T1): wired once the /payments primitive exists.
  await runPayStage(token, policyId, buyer).catch((e) =>
    console.log(`  (pay/disburse stage skipped: ${e.message})`),
  );

  // 9. hire (best-effort; depends on a live provider endpoint)
  if (process.env.E2E_SKIP_HIRE !== '1') {
    await runHireStage(token, policyId).catch((e) =>
      console.log(`  (hire stage warn: ${e.message})`),
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

  // Summary
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

// ── T1 stage: pay + disburse via the /payments primitive ──────────────────────
async function runPayStage(token: string, policyId: string, _buyer: Keypair) {
  // Probe: does the primitive exist yet?
  const probe = await fetch(`${API_URL}/payments`, {
    method: 'OPTIONS',
  }).catch(() => null);
  if (!probe) throw new Error('no /payments endpoint yet');
  // Filled in when T1 lands: POST /payments {kind:'pay', lines:[{payee,amount,reason}], policyId}
  // then poll the task/activity and assert an on-chain release. Left as a stub so the
  // harness runs today and gains real assertions the moment the endpoint exists.
  throw new Error('T1 /payments not implemented yet');
}

// ── Hire stage: create a task against a live service and wait for settle ───────
async function runHireStage(token: string, policyId: string) {
  const list = await api<{ items: any[] }>('/services?limit=20', { token });
  const svc = (list.items || []).find((s) => s.pricePerCall && s.pricePerCall <= 2);
  if (!svc) throw new Error('no affordable service to hire');
  const task = await api<{ id: string }>('/tasks', {
    body: { title: 'e2e hire', mode: 'DIRECT', budget: 2, serviceId: svc.id, policyId },
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
