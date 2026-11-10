import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { GITHUB_SERVICE } from './github.js';

/**
 * Register the GitHub tool (one multi-function service) on CleverCon. Run once after
 * the provider endpoint is deployed and reachable. Signs in with the provider key
 * (SEP-10), so that key is also the payout wallet (no separate payout proof needed).
 *
 * Env:
 *   CLEVERCON_API_URL   the API base, e.g. https://<api>.up.railway.app
 *   PROVIDER_SECRET     Stellar secret (S...) used to sign in AND receive payouts
 *   PROVIDER_ENDPOINT   the deployed provider URL the worker will POST jobs to
 */
function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Required: CLEVERCON_API_URL, PROVIDER_SECRET, PROVIDER_ENDPOINT`);
    process.exit(1);
  }
  return v;
}

async function login(api: string, kp: Keypair): Promise<string> {
  const ch = await fetch(`${api}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: kp.publicKey() }),
  });
  if (!ch.ok) throw new Error(`challenge failed: ${ch.status} ${await ch.text()}`);
  const { transaction, networkPassphrase } = (await ch.json()) as {
    transaction: string;
    networkPassphrase: string;
  };
  const tx = TransactionBuilder.fromXDR(transaction, networkPassphrase);
  tx.sign(kp);
  const verify = await fetch(`${api}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction: tx.toXDR() }),
  });
  if (!verify.ok) throw new Error(`verify failed: ${verify.status} ${await verify.text()}`);
  const { accessToken } = (await verify.json()) as { accessToken: string };
  return accessToken;
}

async function main(): Promise<void> {
  const api = env('CLEVERCON_API_URL').replace(/\/+$/, '');
  const kp = Keypair.fromSecret(env('PROVIDER_SECRET'));
  const endpoint = env('PROVIDER_ENDPOINT');
  const token = await login(api, kp);
  console.log(`Signed in as ${kp.publicKey()}; registering the GitHub tool at ${endpoint}`);

  const res = await fetch(`${api}/provider/services`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: GITHUB_SERVICE.name,
      description: GITHUB_SERVICE.description,
      category: GITHUB_SERVICE.category,
      capabilities: GITHUB_SERVICE.capabilities,
      pricingModel: GITHUB_SERVICE.pricingModel,
      pricePerCall: GITHUB_SERVICE.pricePerCall,
      endpoint,
      stellarAddress: kp.publicKey(),
      tier: GITHUB_SERVICE.tier,
      verification: GITHUB_SERVICE.verification,
      interaction: GITHUB_SERVICE.interaction,
      paymentModel: GITHUB_SERVICE.paymentModel,
      prerequisites: GITHUB_SERVICE.prerequisites,
      functions: GITHUB_SERVICE.functions,
      contactLinks: GITHUB_SERVICE.contactLinks,
    }),
  });
  if (!res.ok) {
    console.error(`x register failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const out = (await res.json()) as { agentId?: string; id?: string };
  console.log(`ok GitHub Tool registered (agentId ${out.agentId ?? '?'}, id ${out.id ?? '?'})`);
  console.log(`${GITHUB_SERVICE.functions.length} functions, ${GITHUB_SERVICE.prerequisites.length} requirement(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
