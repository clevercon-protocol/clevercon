import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  Horizon,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const server = new Horizon.Server(HORIZON_URL);

async function addTrustline(name: string, secretKey: string): Promise<void> {
  const keypair = Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  try {
    const account = await server.loadAccount(publicKey);

    // Check if trustline already exists
    const existing = account.balances.find(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
    );
    if (existing) {
      console.log(`[${name}] ✓ USDC trustline already exists (balance: ${existing.balance})`);
      return;
    }

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(30)
      .build();

    tx.sign(keypair);

    const result = await server.submitTransaction(tx);
    console.log(`[${name}] ✓ USDC trustline created — tx: ${result.hash}`);
  } catch (err: any) {
    if (err?.response?.data?.extras?.result_codes) {
      console.error(`[${name}] ✗ Failed:`, err.response.data.extras.result_codes);
    } else {
      console.error(`[${name}] ✗ Error:`, err.message || err);
    }
  }
}

async function main() {
  const walletsPath = path.join(__dirname, '..', 'wallets.json');
  if (!fs.existsSync(walletsPath)) {
    console.error('wallets.json not found. Run: npm run setup-wallets first.');
    process.exit(1);
  }

  const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));

  console.log('Adding USDC trustlines to all wallets...\n');
  for (const [name, w] of Object.entries(wallets) as [string, any][]) {
    await addTrustline(name, w.secretKey);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('\nDone! Now fund each wallet with USDC at https://faucet.circle.com');
  console.log('Select "Stellar Testnet" and paste each public key:');
  for (const [name, w] of Object.entries(wallets) as [string, any][]) {
    console.log(`  [${name}] ${w.publicKey}`);
  }
  console.log('\nFor the orchestrator, repeat the faucet 2-3 times (needs most USDC).');
}

main().catch(console.error);
