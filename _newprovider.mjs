import { Keypair, Asset, Operation, TransactionBuilder, Horizon, BASE_FEE, Networks } from '@stellar/stellar-sdk';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', ISSUER);
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const kp = Keypair.random();
console.log('NEW_PROVIDER_PUBLIC=' + kp.publicKey());
console.log('NEW_PROVIDER_SECRET=' + kp.secret());
console.log('funding via friendbot…');
const fb = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
console.log('friendbot HTTP', fb.status);
await new Promise(r=>setTimeout(r,2500));
const acct = await horizon.loadAccount(kp.publicKey());
const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(60).build();
tx.sign(kp);
const res = await horizon.submitTransaction(tx);
console.log('USDC trustline added, tx', res.hash);
const after = await horizon.loadAccount(kp.publicKey());
console.log('balances:', after.balances.map(b=>`${b.asset_code||b.asset_type}=${b.balance}`).join(', '));
