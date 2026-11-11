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

/**
 * Resolve (or create) the org to list under, when ORG_HANDLE is set. ORG_NAME is used
 * if the org must be created. Returns the org id, or undefined when no org is requested.
 */
async function resolveOrg(
  api: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const handle = process.env.ORG_HANDLE?.trim().toLowerCase();
  if (!handle) return undefined;
  const mineRes = await fetch(`${api}/orgs/mine`, { headers });
  if (mineRes.ok) {
    const mine = (await mineRes.json()) as { id: string; handle: string }[];
    const found = mine.find((o) => o.handle === handle);
    if (found) {
      console.log(`Listing under existing org @${handle} (${found.id})`);
      return found.id;
    }
  }
  const name = process.env.ORG_NAME?.trim() || handle;
  const createRes = await fetch(`${api}/orgs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, handle }),
  });
  if (!createRes.ok) throw new Error(`create org failed: ${createRes.status} ${await createRes.text()}`);
  const org = (await createRes.json()) as { id: string };
  console.log(`Created org @${handle} (${org.id}); an admin must verify it for the tick.`);
  return org.id;
}

async function main(): Promise<void> {
  const api = env('CLEVERCON_API_URL').replace(/\/+$/, '');
  const kp = Keypair.fromSecret(env('PROVIDER_SECRET'));
  const endpoint = env('PROVIDER_ENDPOINT');
  const token = await login(api, kp);
  const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const ownerOrgId = await resolveOrg(api, authHeaders);
  console.log(`Signed in as ${kp.publicKey()}; registering the GitHub tool at ${endpoint}`);

  const res = await fetch(`${api}/provider/services`, {
    method: 'POST',
    headers: authHeaders,
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
      ...(ownerOrgId ? { ownerOrgId } : {}),
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
