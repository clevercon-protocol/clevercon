import { Keypair } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Maps wallet name → the env var prefix used by each service.
// Must match the process.env.<PREFIX>_SECRET_KEY references in each server.ts.
const ENV_KEYS: Record<string, string> = {
  orchestrator: 'ORCHESTRATOR',
  'stellar-oracle': 'STELLAR_ORACLE',
  'web-intel': 'WEB_INTEL',
  'web-intel-v2': 'WEB_INTEL_V2',
  analysis: 'ANALYSIS_AGENT',
  reporter: 'REPORT_AGENT',
};

async function friendbotFund(publicKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    if (res.ok) {
      console.log(`  ✓ Friendbot funded: ${publicKey}`);
      return true;
    } else {
      const body = await res.text();
      console.warn(`  ⚠ Friendbot failed for ${publicKey}: ${body}`);
      return false;
    }
  } catch (err) {
    console.warn(`  ⚠ Friendbot error for ${publicKey}: ${err}`);
    return false;
  }
}

async function main() {
  const wallets: Record<string, { publicKey: string; secretKey: string }> = {};

  console.log('Generating wallets and funding via Friendbot...\n');

  for (const name of Object.keys(ENV_KEYS)) {
    const kp = Keypair.random();
    wallets[name] = { publicKey: kp.publicKey(), secretKey: kp.secret() };
    console.log(`[${name}]`);
    console.log(`  Public Key : ${kp.publicKey()}`);
    await friendbotFund(kp.publicKey());
    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Save wallets.json (gitignored)
  const walletsPath = path.join(__dirname, '..', 'wallets.json');
  fs.writeFileSync(walletsPath, JSON.stringify(wallets, null, 2));
  console.log('\n✓ Saved wallets.json (gitignored — keep this safe!)\n');

  // Print .env entries
  console.log('─'.repeat(60));
  console.log('Add the following to your .env file:');
  console.log('─'.repeat(60));
  for (const [name, w] of Object.entries(wallets)) {
    const envKey = `${ENV_KEYS[name]}_SECRET_KEY`;
    console.log(`# ${name} wallet: ${w.publicKey}`);
    console.log(`${envKey}=${w.secretKey}`);
    console.log('');
  }

  console.log('─'.repeat(60));
  console.log('NEXT STEPS:');
  console.log('─'.repeat(60));
  console.log('1. Copy the *_SECRET_KEY lines above into your .env file.');
  console.log('2. Run: npx tsx scripts/add-usdc-trustlines.ts');
  console.log('   (adds USDC trustlines to every wallet using wallets.json)');
  console.log('3. Fund the ORCHESTRATOR with testnet USDC:');
  console.log(`   https://faucet.circle.com  → Stellar Testnet → paste orchestrator public key`);
  console.log('   Click the faucet button 2-3 times (need ~15 USDC total).');
  console.log(`   Orchestrator: ${wallets['orchestrator']?.publicKey ?? ''}`);
  console.log('4. Run: npx tsx scripts/distribute-usdc.ts');
  console.log('   (sends USDC from orchestrator to each agent wallet)');
  console.log('\nVerify balances at: https://stellar.expert/explorer/testnet/account/<PUBLIC_KEY>');
}

main().catch(console.error);
