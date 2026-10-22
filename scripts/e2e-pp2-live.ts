/**
 * Live end-to-end for the single-vault cutover + pp/2 trustless batch release.
 *
 * Runs against the LIVE API (Railway) and LIVE testnet. One fresh buyer:
 *   fund -> trustline -> faucet USDC -> SEP-10 sign-in -> deposit -> authorize
 *   delegate -> [A] pay via /payments (pp/1 binding path, proves the cutover +
 *   the binding VK on the new verifier) -> [B] trustless batch disburse via
 *   /vault/batch-release-proved with a REAL client Groth16 proof (the SDK prover)
 *   -> [C] replay the same proof (nullifier already spent -> no double pay) ->
 *   [D] withdraw.
 *
 * Not committed to the product surface; a throwaway live validator. Run:
 *   NODE_PATH="$(pwd)/node_modules:$(npm root -g)" \
 *     npx tsx scripts/e2e-pp2-live.ts
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
import { createBatchProof, buildBatchReleaseRequest } from '@clevercon/agent-sdk';
import type { PolicyWitness, BatchRelease, BatchContext } from '@clevercon/agent-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.API_URL ?? 'https://cleverconapi-production.up.railway.app';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);
const WASM = process.env.PP2_WASM ?? '/mnt/c/Users/joshu/Downloads/policy_batch.wasm';
const ZKEY = process.env.PP2_ZKEY ?? '/mnt/c/Users/joshu/Downloads/policy_batch_final.zkey';
const DEPOSIT = Number(process.env.E2E_DEPOSIT ?? '5');

const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);

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
async function faucetSend(to: string, amount: number) {
  const acct = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(amount) }))
    .setTimeout(60)
    .build();
  tx.sign(faucet);
  return submitClassic(tx);
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
async function waitTaskComplete(token: string, taskId: string, label: string) {
  let status = '';
  let spent = 0;
  for (let i = 0; i < 36; i++) {
    const t = await api<{ status: string; spent: number; budget: number }>(`/tasks/${taskId}`, {
      token,
    });
    status = t.status;
    spent = t.spent;
    if (t.status === 'COMPLETED' && t.spent >= t.budget - 0.001) break;
    if (['FAILED', 'CANCELLED'].includes(t.status)) break;
    await sleep(5000);
  }
  record(`${label} settle`, status === 'COMPLETED' && spent > 0, `status ${status} spent ${spent}`);
}

/** An R1-only (per-payment ceiling) policy; other rules disabled. Proven to
 * verify against the deployed Groth16 VK. Caps high enough to admit the release. */
function r1OnlyPolicy(ceilingStroops: string): PolicyWitness {
  return {
    enabled: [true, false, false, false, false, false, false, false],
    salt: String(Math.floor(Math.random() * 1e15)),
    r1Ceiling: ceilingStroops,
    r2Cap: '0',
    r2WindowSecs: '0',
    r2Delegate: '0',
    r3Root: '0',
    r3Depth: '16',
    r4Entries: ['0', '0', '0', '0'],
    r4Threshold: '0',
    r6WindowsRoot: '0',
    r6Windows: [
      { start: '0', end: '0' },
      { start: '0', end: '0' },
    ],
    r7MaxCount: '0',
    r7WindowSecs: '0',
    r8CatCeilings: ['0', '0', '0', '0'],
    disclosureTag: '0',
  };
}

async function main() {
  console.log(`\nCleverCon pp/2 LIVE e2e  (api=${API_URL})\n`);
  for (const f of [WASM, ZKEY])
    if (!fs.existsSync(f)) throw new Error(`missing proving artifact: ${f}`);

  const buyer = Keypair.random();
  console.log(`buyer: ${buyer.publicKey()}  (throwaway secret ${buyer.secret()})\n`);

  // 0. onboard: fund, trustline, faucet USDC, sign-in, deposit, delegate.
  const fb = await fetch(`${FRIENDBOT}?addr=${buyer.publicKey()}`);
  record('friendbot XLM', fb.ok, `${fb.status}`);
  await sleep(2500);
  {
    const acct = await horizon.loadAccount(buyer.publicKey());
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(buyer);
    record('USDC trustline', true, (await submitClassic(tx)).slice(0, 10));
  }
  await ensureFaucetUsdc(DEPOSIT + 3);
  await faucetSend(buyer.publicKey(), DEPOSIT + 1);
  const startUsdc = await usdcBalance(buyer.publicKey());
  record('faucet USDC', startUsdc >= DEPOSIT, `buyer has ${startUsdc} USDC`);

  const token = await signIn(buyer);
  record('SEP-10 sign-in', !!token, `jwt ${token.slice(0, 10)}...`);

  // Report which vault the API is bound to (informational; the pinned-set path
  // below is what proves the A2.3 membership model, on whichever vault is live).
  const status = await api<{ contractAddress?: string; depositsEnabled?: boolean }>(
    '/vault/status',
    { token },
  );
  const vaultId = status.contractAddress ?? '';
  record('vault bound', !!vaultId, vaultId || JSON.stringify(status));

  // Pin a rule's canonical commitment to the buyer's account (set_policy_commitment):
  // the wallet signs, the API submits. A2.3 requires this before any proof-gated
  // release, so both spend paths below pin first or the vault returns
  // CommitmentNotAuthorized.
  async function pin(commitmentHex: string) {
    const built = await api<{ xdr: string }>('/vault/pin-commitment', {
      body: { commitment: commitmentHex },
      token,
    });
    await api<{ txHash: string }>('/vault/submit', {
      body: { signedXdr: signXdr(built.xdr, buyer) },
      token,
    });
  }

  {
    const su = await stepUp(buyer);
    const built = await api<{ xdr: string }>('/vault/deposit', {
      body: { amountUsdc: DEPOSIT },
      token,
      stepup: su,
    });
    const sub = await api<{ txHash: string }>('/vault/submit', {
      body: { signedXdr: signXdr(built.xdr, buyer) },
      token,
    });
    record('deposit submit', !!sub.txHash, sub.txHash.slice(0, 10));
  }
  {
    let bal = 0;
    for (let i = 0; i < 30; i++) {
      bal = (await api<{ balance: number }>('/vault', { token })).balance;
      if (bal >= DEPOSIT - 0.001) break;
      await sleep(5000);
    }
    record('deposit mirrored', bal >= DEPOSIT - 0.001, `vault balance ${bal} USDC`);
  }
  {
    const built = await api<{ xdr: string }>('/vault/delegate/register', { body: {}, token });
    await api('/vault/submit', { body: { signedXdr: signXdr(built.xdr, buyer) }, token });
    await api('/vault/delegate/confirm', { body: {}, token });
    const d = await api<{ registered: boolean }>('/vault/delegate', { token });
    record('authorize delegate', d.registered, 'registered');
  }

  // ── A. pay via /payments (pp/1 binding path) ────────────────────────────────
  {
    const policy = await api<{ id: string; commitment: string }>('/policies', {
      body: {
        rules: {
          perPaymentCeilingUsdc: DEPOSIT,
          rollingCapUsdc: DEPOSIT * 3,
          rollingWindowSecs: 86400,
        },
        isPrivate: false,
      },
      token,
    });
    // pp/1 release_payment_proved also checks pinned-set membership, so the buyer
    // pins this public policy's (server-derived) commitment before paying.
    await pin(policy.commitment);
    record('A) public commitment pinned', true, `${policy.commitment.slice(0, 12)}...`);
    const pay = await api<{ id: string }>('/payments', {
      body: {
        kind: 'pay',
        lines: [{ payee: faucet.publicKey(), amount: 0.5, reason: 'pp1 pay' }],
        policyId: policy.id,
      },
      token,
    });
    await waitTaskComplete(token, pay.id, 'A) pp1 pay');
  }

  // ── B. trustless batch disburse via /vault/batch-release-proved (pp/2) ───────
  const payAmtStroops = '5000000'; // 0.5 USDC
  const now = Math.floor(Date.now() / 1000);
  const ctx: BatchContext = {
    validAfter: String(now - 3600),
    validBefore: String(now + 86400),
    runningSpend: '0',
    priorCount: '0',
  };
  const policy = r1OnlyPolicy('100000000'); // 10 USDC ceiling
  const releases: BatchRelease[] = [
    { payeeAddress: faucet.publicKey(), amountStroops: payAmtStroops, spendCounter: '0' },
  ];

  const faucetBefore = await usdcBalance(faucet.publicKey());
  console.log('  proving (snarkjs, ~60s)...');
  const proof = await createBatchProof(policy, releases, ctx, { wasmPath: WASM, zkeyPath: ZKEY });
  record(
    'B) client proof generated',
    !!proof.commitment,
    `commitment ${proof.commitment.toString('hex').slice(0, 12)}...`,
  );

  // Pin the proof's canonical commitment (the private rule the owner authorizes)
  // before relaying, so release_payment_proved_batch finds it in the pinned set.
  await pin(proof.commitment.toString('hex'));
  record(
    'B) private commitment pinned',
    true,
    `${proof.commitment.toString('hex').slice(0, 12)}...`,
  );

  const stepId = Math.floor(Date.now() / 1000) % 1_000_000;
  const request = buildBatchReleaseRequest(proof, releases, ctx, {
    vaultTaskId: null,
    planCostUsdc: 1,
    stepId,
  });
  const resp = await api<{ jobId: string; status: string }>('/vault/batch-release-proved', {
    body: request,
    token,
  });
  record('B) batch relay accepted', resp.status === 'queued', `job ${resp.jobId}`);

  {
    let moved = 0;
    for (let i = 0; i < 36; i++) {
      const cur = await usdcBalance(faucet.publicKey());
      moved = cur - faucetBefore;
      if (moved >= 0.5 - 0.001) break;
      await sleep(5000);
    }
    record('B) pp/2 release moved funds', moved >= 0.5 - 0.001, `payee +${moved.toFixed(4)} USDC`);
  }

  // ── C. replay the same proof: the nullifier is spent -> no double pay ────────
  {
    const before = await usdcBalance(faucet.publicKey());
    const replay = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: 1,
      stepId: stepId + 1, // fresh step so it reaches the chain, not just queue-deduped
    });
    await api('/vault/batch-release-proved', { body: replay, token }).catch((e) =>
      console.log(`  (replay relay note: ${e.message})`),
    );
    let doubled = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(5000);
      doubled = (await usdcBalance(faucet.publicKey())) - before;
      if (doubled >= 0.5 - 0.001) break;
    }
    record(
      'C) replay blocked (no double pay)',
      doubled < 0.5 - 0.001,
      `payee delta +${doubled.toFixed(4)} USDC`,
    );
  }

  // ── D. withdraw whatever is available ────────────────────────────────────────
  try {
    const v = await api<{ available: number }>('/vault', { token });
    if (v.available > 0.01) {
      const su = await stepUp(buyer);
      const built = await api<{ xdr: string }>('/vault/withdraw', {
        body: { amountUsdc: Math.floor(v.available * 100) / 100 },
        token,
        stepup: su,
      });
      const sub = await api<{ txHash: string }>('/vault/submit', {
        body: { signedXdr: signXdr(built.xdr, buyer) },
        token,
      });
      record('D) withdraw', !!sub.txHash, `${v.available} USDC, tx ${sub.txHash.slice(0, 10)}`);
    } else {
      record('D) withdraw', true, 'nothing available (skipped)');
    }
  } catch (e) {
    console.log(`  (withdraw note: ${(e as Error).message})`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed.\n`);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} stages passed before failure.\n`);
  process.exit(1);
});
