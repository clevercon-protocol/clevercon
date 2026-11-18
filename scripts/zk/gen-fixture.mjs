// Convert a snarkjs BLS12-381 Groth16 verifying key + proof + public signals into
// the uncompressed byte encoding the Soroban policy-verifier expects (G1 = 96
// bytes, G2 = 192 bytes, scalars = 32 bytes, all big-endian), and emit a Rust
// fixture module the verifier test includes.
//
//   node gen-fixture.mjs vkey.json proof.json public.json out/fixture_data.rs
//
// snarkjs stores each Fp2 coordinate as [c0, c1]; Soroban's uncompressed G2
// encoding (EIP-2537 style) wants the two limbs in the reverse order, so each
// Fp2 pair is emitted as c1 || c0.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , vkeyPath, proofPath, publicPath, outPath] = process.argv;
const vkey = JSON.parse(readFileSync(vkeyPath, 'utf8'));
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const pub = JSON.parse(readFileSync(publicPath, 'utf8'));

const be = (dec, nbytes) => {
  const h = BigInt(dec).toString(16);
  if (h.length > nbytes * 2) throw new Error(`value exceeds ${nbytes} bytes: ${dec}`);
  return h.padStart(nbytes * 2, '0');
};
// G1 affine [x, y, 1] -> x(48) || y(48)
const g1 = (p) => be(p[0], 48) + be(p[1], 48);
// G2 affine [[x_c0, x_c1], [y_c0, y_c1], ...] -> x.c1 || x.c0 || y.c1 || y.c0
const g2 = (p) => be(p[0][1], 48) + be(p[0][0], 48) + be(p[1][1], 48) + be(p[1][0], 48);

const ic = vkey.IC.map(g1);
const pubs = pub.map((d) => be(d, 32));

const rust = `// AUTO-GENERATED BLS12-381 Groth16 fixture. Do not edit; regenerated in CI.
pub const ALPHA_G1: &str = "${g1(vkey.vk_alpha_1)}";
pub const BETA_G2: &str = "${g2(vkey.vk_beta_2)}";
pub const GAMMA_G2: &str = "${g2(vkey.vk_gamma_2)}";
pub const DELTA_G2: &str = "${g2(vkey.vk_delta_2)}";
pub const IC: &[&str] = &[${ic.map((h) => `"${h}"`).join(', ')}];
pub const PROOF_A: &str = "${g1(proof.pi_a)}";
pub const PROOF_B: &str = "${g2(proof.pi_b)}";
pub const PROOF_C: &str = "${g1(proof.pi_c)}";
pub const PUBLIC_INPUTS: &[&str] = &[${pubs.map((h) => `"${h}"`).join(', ')}];
`;

writeFileSync(outPath, rust);
console.log(rust);
