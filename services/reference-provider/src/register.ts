import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { SERVICES } from './services.js';

/**
 * Register this provider's catalog on CleverCon. Run once after the provider is
 * deployed and reachable. The script signs in with the provider key (SEP-10), so
 * that key is also the payout wallet and no separate payout proof is needed; each
 * service is registered with its full acceptance contract (tier + io + verifier).
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
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  // Register everything by default, or just the actions named in ONLY (comma-
  // separated) so you can add ONE new service without re-creating the others.
  const only = (process.env.ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const toRegister = only.length ? SERVICES.filter((s) => only.includes(s.action)) : SERVICES;
  if (only.length && toRegister.length === 0) {
    console.error(`No services match ONLY=${only.join(',')}. Known: ${SERVICES.map((s) => s.action).join(', ')}`);
    process.exit(1);
  }
  console.log(`Signed in as ${kp.publicKey()}; registering ${toRegister.length} service(s) at ${endpoint}`);

  for (const s of toRegister) {
    const res = await fetch(`${api}/provider/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: s.name,
        description: s.description,
        category: s.category,
        capabilities: [s.action],
        pricingModel: 'X402',
        pricePerCall: s.pricePerCall,
        endpoint,
        stellarAddress: kp.publicKey(), // own wallet, so no payout proof needed
        tier: s.tier,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
        verification: s.verification,
        // Manifest-v2 shape (so the marketplace knows it takes a file, etc.).
        ...(s.interaction ? { interaction: s.interaction } : {}),
        ...(s.paymentModel ? { paymentModel: s.paymentModel } : {}),
        ...(s.attachmentsIn ? { attachmentsIn: s.attachmentsIn } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`  x ${s.name}: ${res.status} ${await res.text()}`);
      continue;
    }
    const out = (await res.json()) as { agentId?: string };
    console.log(`  ok ${s.name} (tier ${s.tier}, agentId ${out.agentId ?? '?'})`);
  }
  console.log('Done. Set VERIFIED_AGENT_IDS on the API to an agentId above for the verified badge.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
