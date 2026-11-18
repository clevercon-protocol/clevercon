/**
 * Live test of the agent (MCP/SDK) pp/2 path end to end against the deployed API.
 * Drives the exact MCP `disburse_private` handler: it loads a private policy
 * bundle + proving artifacts, proves a batch locally, and submits to the live
 * relay with an API key, same as an agent would. Verifies funds move on-chain.
 *
 * Prereqs provisioned via env (as an owner would for their agent):
 *   CLEVERCON_API_KEY, CLEVERCON_POLICY_JSON, CLEVERCON_PP2_WASM, CLEVERCON_PP2_ZKEY
 * Needs a buyer that has already deposited + authorized a delegate on the vault;
 * pass BUYER_SECRET (reused across runs) or let this onboard a fresh one via the
 * REST flow if BUYER_SECRET is unset.
 */
import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  Horizon,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { disbursePrivateHandler } from '../packages/mcp/src/tools/disburse-private.js';
import { policyCommitment, policyWitnessFromBundle } from '@clevercon/agent-sdk/prover';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.API_URL ?? 'https://cleverconapi-production.up.railway.app';
const HORIZON = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON);
const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf-8'));
const faucet = Keypair.fromSecret(wallets.orchestrator.secretKey);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(
  p: string,
  o: { body?: unknown; token?: string; stepup?: string } = {},
): Promise<T> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (o.token) h.authorization = `Bearer ${o.token}`;
  if (o.stepup) h['x-stepup'] = o.stepup;
  const res = await fetch(`${API_URL}${p}`, {
    method: o.body ? 'POST' : 'GET',
    headers: h,
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${p} ${res.status}: ${t.slice(0, 300)}`);
  return (t ? JSON.parse(t) : {}) as T;
}
const signXdr = (xdr: string, kp: Keypair) => {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  tx.sign(kp);
  return tx.toXDR();
};
async function usdc(pk: string) {
  try {
    const a = await horizon.loadAccount(pk);
    const b = a.balances.find(
      (x: any) => x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER,
    ) as any;
    return parseFloat(b?.balance ?? '0');
  } catch {
    return 0;
  }
}
async function ensureFaucetUsdc(min: number) {
  const bal = await usdc(faucet.publicKey());
  if (bal >= min) return;
  const need = Math.ceil(min - bal) + 2;
  const a = await horizon.loadAccount(faucet.publicKey());
  const tx = new TransactionBuilder(a, { fee: '1000', networkPassphrase: PASSPHRASE })
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
async function challenge(kp: Keypair) {
  const c = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  return signXdr(c.transaction, kp);
}

async function main() {
  console.log(`\nMCP disburse_private LIVE  (api=${API_URL})\n`);
  const buyer = Keypair.random();
  console.log(`buyer ${buyer.publicKey()}`);
  // onboard
  await (await fetch(`https://friendbot.stellar.org?addr=${buyer.publicKey()}`)).text();
  await sleep(2500);
  {
    const a = await horizon.loadAccount(buyer.publicKey());
    const tx = new TransactionBuilder(a, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(buyer);
    await horizon.submitTransaction(tx);
  }
  await ensureFaucetUsdc(7);
  {
    const a = await horizon.loadAccount(faucet.publicKey());
    const tx = new TransactionBuilder(a, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.payment({ destination: buyer.publicKey(), asset: USDC, amount: '6' }))
      .setTimeout(60)
      .build();
    tx.sign(faucet);
    await horizon.submitTransaction(tx);
  }
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: buyer.publicKey() },
  });
  const token = (
    await api<{ accessToken: string }>('/auth/verify', {
      body: { transaction: signXdr(ch.transaction, buyer) },
    })
  ).accessToken;
  console.log('signed in');
  {
    const su = await challenge(buyer);
    const b = await api<{ xdr: string }>('/vault/deposit', {
      body: { amountUsdc: 5 },
      token,
      stepup: su,
    });
    await api('/vault/submit', { body: { signedXdr: signXdr(b.xdr, buyer) }, token });
  }
  for (let i = 0; i < 30; i++) {
    const v = await api<{ balance: number }>('/vault', { token });
    if (v.balance >= 4.999) break;
    await sleep(5000);
  }
  console.log('deposited + mirrored');
  {
    const b = await api<{ xdr: string }>('/vault/delegate/register', { body: {}, token });
    await api('/vault/submit', { body: { signedXdr: signXdr(b.xdr, buyer) }, token });
    await api('/vault/delegate/confirm', { body: {}, token });
  }
  console.log('delegate authorized');

  // mint a scoped API key for the agent (the MCP uses x-api-key)
  const key = await api<{ key?: string; apiKey?: string; token?: string }>('/api-keys', {
    body: { name: 'pp2-mcp-e2e' },
    token,
  });
  const apiKey = key.key ?? key.apiKey ?? key.token;
  if (!apiKey) throw new Error(`no api key in ${JSON.stringify(key)}`);
  console.log('minted api key', String(apiKey).slice(0, 8) + '...');

  // provision the agent's private policy + artifacts (as the owner would)
  process.env.CLEVERCON_POLICY_JSON = JSON.stringify({
    rules: { perPaymentCeilingUsdc: 10 },
    salt: String(Math.floor(Math.random() * 1e15)),
  });
  process.env.CLEVERCON_PP2_WASM =
    process.env.CLEVERCON_PP2_WASM ?? '/mnt/c/Users/joshu/Downloads/policy_batch.wasm';
  process.env.CLEVERCON_PP2_ZKEY =
    process.env.CLEVERCON_PP2_ZKEY ?? '/mnt/c/Users/joshu/Downloads/policy_batch_final.zkey';

  // The OWNER pins the provisioned rule's canonical commitment once (A2.3
  // membership): the agent only proves, it never pins. Compute the commitment from
  // the same bundle the agent holds (R1-only here, so no Poseidon oracle needed)
  // and pin it with the owner's wallet, exactly as the dapp "pin" flow does.
  {
    const bundle = JSON.parse(process.env.CLEVERCON_POLICY_JSON as string);
    const witness = policyWitnessFromBundle(bundle);
    const commitmentHex = (
      await policyCommitment(witness, { wasmPath: process.env.CLEVERCON_PP2_WASM as string })
    ).toString('hex');
    const pinBuilt = await api<{ xdr: string }>('/vault/pin-commitment', {
      body: { commitment: commitmentHex },
      token,
    });
    await api('/vault/submit', { body: { signedXdr: signXdr(pinBuilt.xdr, buyer) }, token });
    console.log('owner pinned commitment', commitmentHex.slice(0, 12) + '...');
  }

  const before = await usdc(faucet.publicKey());
  console.log('proving + submitting via MCP disburse_private (snarkjs ~60s)...');
  const res = await disbursePrivateHandler(
    { lines: [{ payee: faucet.publicKey(), amount: 0.5 }] },
    { api_url: API_URL, api_key: String(apiKey) },
  );
  console.log(res.content[0].text);

  let moved = 0;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    moved = (await usdc(faucet.publicKey())) - before;
    if (moved >= 0.499) break;
  }
  console.log(
    moved >= 0.499
      ? `\n✓ MCP pp/2 moved funds: payee +${moved.toFixed(4)} USDC\n`
      : `\n✗ funds did not move (delta +${moved.toFixed(4)})\n`,
  );
  process.exit(moved >= 0.499 ? 0 : 1);
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
