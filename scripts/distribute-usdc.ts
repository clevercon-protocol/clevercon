/**
 * Distributes testnet USDC from orchestrator to agent wallets.
 * Orchestrator keeps the bulk; agents get just enough to pay external services.
 */
import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  Horizon,
  Memo,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const server = new Horizon.Server(HORIZON_URL);

// How much USDC to send to each agent
// Agents that call xlm402.com need more; reporter/analysis just receive payments
const DISTRIBUTION: Record<string, string> = {
  'stellar-oracle': '3',   // pays xlm402.com for market data (~$0.01/call)
  'web-intel':      '3',   // pays xlm402.com for news/scrape (~$0.01-0.03/call)
  'web-intel-v2':   '2',   // pays xlm402.com for news
  'analysis':       '1',   // receives MPP payments, minimal outgoing
  'reporter':       '1',   // receives x402 payments, no outgoing
};

async function sendUSDC(
  senderKeypair: Keypair,
  destinationPublicKey: string,
  amount: string,
  label: string
): Promise<void> {
  const account = await server.loadAccount(senderKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset: USDC,
        amount,
      })
    )
    .addMemo(Memo.text(`AgentForge: ${label}`))
    .setTimeout(30)
    .build();

  tx.sign(senderKeypair);
  const result = await server.submitTransaction(tx);
  console.log(`  ✓ Sent ${amount} USDC to [${label}] — tx: ${result.hash}`);
}

async function getUSDCBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const usdc = account.balances.find(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
    ) as any;
    return usdc?.balance || '0';
  } catch {
    return 'N/A';
  }
}

async function main() {
  const walletsPath = path.join(__dirname, '..', 'wallets.json');
  if (!fs.existsSync(walletsPath)) {
    console.error('wallets.json not found. Run: npm run setup-wallets first.');
    process.exit(1);
  }

  const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
  const orchestratorKeypair = Keypair.fromSecret(wallets.orchestrator.secretKey);

  const orchBalance = await getUSDCBalance(wallets.orchestrator.publicKey);
  console.log(`Orchestrator USDC balance: ${orchBalance}`);
  console.log('Distributing USDC to agent wallets...\n');

  for (const [name, amount] of Object.entries(DISTRIBUTION)) {
    if (!wallets[name]) {
      console.warn(`  ⚠ No wallet found for [${name}], skipping`);
      continue;
    }
    const before = await getUSDCBalance(wallets[name].publicKey);
    if (parseFloat(before) >= parseFloat(amount)) {
      console.log(`  [${name}] already has ${before} USDC, skipping`);
      continue;
    }
    await sendUSDC(orchestratorKeypair, wallets[name].publicKey, amount, name);
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\nFinal balances:');
  for (const [name, w] of Object.entries(wallets) as [string, any][]) {
    const bal = await getUSDCBalance(w.publicKey);
    console.log(`  [${name}] ${w.publicKey.slice(0, 8)}... → ${bal} USDC`);
  }
}

main().catch(console.error);
