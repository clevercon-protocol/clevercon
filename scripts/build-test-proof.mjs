// Build a binding proof with the TS prover and print the exact args to feed to
// `stellar contract invoke verify_policy` for an on-chain cross-language check.
import { buildBindingProof, verifyBindingProofLocally } from '../packages/common/src/spend-policy-prover.js';
import { createHash } from 'node:crypto';

const PAYEE = process.argv[2] || 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const AMOUNT_STROOPS = BigInt(process.argv[3] || '20000000'); // 2 USDC
const commitment = createHash('sha256').update('onchain-test-policy').digest();
const nullifier = createHash('sha256').update('onchain-test-nullifier').digest();

const { proof, piHash } = buildBindingProof({
  commitment,
  payeeAddress: PAYEE,
  amountStroops: AMOUNT_STROOPS,
  nullifier,
});

if (!verifyBindingProofLocally(proof, piHash)) {
  console.error('LOCAL VERIFY FAILED');
  process.exit(1);
}

console.log(JSON.stringify({
  commitment: commitment.toString('hex'),
  payee: PAYEE,
  amount: AMOUNT_STROOPS.toString(),
  nullifier: nullifier.toString('hex'),
  proof: proof.toString('hex'),
  piHash: piHash.toString('hex'),
}, null, 2));
