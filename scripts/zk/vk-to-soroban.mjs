// Convert a snarkjs policy_batch_vkey.json into the Soroban Groth16Vk component
// bytes needed to call the policy-verifier's set_groth16_vk. Prints JSON with
// hex-encoded alpha_g1 (96), beta_g2/gamma_g2/delta_g2 (192 each), and ic (96
// each). Same encoding the zk-fixture CI proves (G2 Fp2 limbs reversed to c1||c0).
//
//   node vk-to-soroban.mjs policy_batch_vkey.json > groth16-vk.json
import { readFileSync } from 'node:fs';

const vkey = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const be = (dec, nbytes) => {
  const h = BigInt(dec).toString(16);
  if (h.length > nbytes * 2) throw new Error(`value exceeds ${nbytes} bytes: ${dec}`);
  return h.padStart(nbytes * 2, '0');
};
const g1 = (p) => be(p[0], 48) + be(p[1], 48);
const g2 = (p) => be(p[0][1], 48) + be(p[0][0], 48) + be(p[1][1], 48) + be(p[1][0], 48);

const out = {
  alpha_g1: g1(vkey.vk_alpha_1),
  beta_g2: g2(vkey.vk_beta_2),
  gamma_g2: g2(vkey.vk_gamma_2),
  delta_g2: g2(vkey.vk_delta_2),
  ic: vkey.IC.map(g1),
};

console.log(JSON.stringify(out, null, 2));
