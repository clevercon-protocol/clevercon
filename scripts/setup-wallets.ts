import { Keypair } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENTITIES = [
  'orchestrator',
  'stellar-oracle',
  'web-intel',
  'web-intel-v2',
  'analysis',
  'reporter',
];

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

  for (const name of ENTITIES) {
    const kp = Keypair.random();
    wallets[name] = { publicKey: kp.publicKey(), secretKey: kp.secret() };
    console.log(`[${name}]`);
    console.log(`  Public Key : ${kp.publicKey()}`);
    await friendbotFund(kp.publicKey());
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1200));
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
    const envKey = name.toUpperCase().replace(/-/g, '_') + '_SECRET_KEY';
    console.log(`# ${name} wallet: ${w.publicKey}`);
    console.log(`${envKey}=${w.secretKey}`);
    console.log('');
  }

  console.log('─'.repeat(60));
  console.log('NEXT STEPS (manual — required before proceeding):');
  console.log('─'.repeat(60));
  console.log('For EACH public key above:');
  console.log('  1. Go to https://lab.stellar.org/account/fund');
  console.log('     Paste the public key → Create USDC trustline');
  console.log('  2. Go to https://faucet.circle.com');
  console.log('     Select "Stellar Testnet" → Paste public key → Get USDC');
  console.log('  3. For ORCHESTRATOR: repeat the faucet 2-3 times (needs most USDC)');
  console.log('\nVerify balances at: https://stellar.expert/explorer/testnet/account/<PUBLIC_KEY>');
}

main().catch(console.error);
