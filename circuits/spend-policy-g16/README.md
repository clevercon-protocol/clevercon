# spend-policy-g16

The pp/2 spend-policy circuit: circom over **BLS12-381**, Groth16, so the proof is
verified by a real pairing on-chain (`contracts/policy-verifier` `verify_groth16`,
proven in the `zk-fixture` CI). Spec: [docs/private-policies-v2.md](../../docs/private-policies-v2.md).

This supersedes the pp/1 Noir circuit in `../spend-policy` (BN-254 / binding check),
which stays for the deployed testnet path.

## Public interface (`policy_single.circom`, increment g16-single)

- Public **outputs** (circuit-computed): `commitment`, `nullifier`.
- Public **inputs** (vault-supplied): `payee_field`, `amount`.

snarkjs orders public signals as outputs then inputs, so the public-signal vector
is `[commitment, nullifier, payee_field, amount]`. The on-chain verifier is
agnostic to the meaning of each signal (the pairing binds them positionally), and
the vault maps them by this order.

## Increments

1. **g16-single** (`policy_single.circom`): R1, plus R3 (allowlist Merkle
   membership, depth 16 = 65,536 payees) and R5 (per-payee limit, carried in the
   leaf = `H(payee_field, cap)`; requires R3). Binds the full policy encoding into
   the commitment, so the commitment format is final. (proven)
2. **g16-batch** (`policy_batch.circom`, CI circuit): one proof authorizes N
   releases (bounty payout, payroll run) under the same policy, enforcing the FULL
   R1-R8 rule set + N nullifiers + an `active` flag so a partial batch's null slots
   are provable no-ops (nullifier 0, vault skips). Per-release: R1 ceiling, R3
   membership, R4 deny-list, R5 per-payee cap, R8 per-category ceiling (R5 cap and
   R8 category ride the leaf `H(payee, cap, category)`). Batch-level: R2 rolling
   cap and R7 velocity against the vault's authenticated `running_spend` /
   `prior_count`, and R6 calendar via a public `[valid_after, valid_before]`
   validity window (the circuit proves it sits inside the private calendar; the
   vault checks ledger time falls within it). Uses the final R1-R8 commitment
   encoding. Supersedes the single circuit; the single remains as the N=1 reference.

Next: productionize (trusted-setup ceremony, client prover in the SDK, vault
wiring); a fully in-circuit private accumulator for R2/R7 is a later hardening.

## How CI proves it

The `zk-fixture` workflow compiles the batch circuit with `--prime bls12381`,
builds a satisfiable batch witness with `scripts/zk/build-ci-witness.cjs` (which
uses the compiled `poseidon2.circom` as a hash oracle to construct a real allowlist
membership path, so the off-circuit tree matches the in-circuit Poseidon exactly),
runs a throwaway Groth16 setup, proves, converts the VK/proof/public signals to
Soroban bytes (`scripts/zk/gen-fixture.mjs`), and runs the Rust test
(`contracts/policy-verifier/tests/groth16_fixture.rs`), which asserts the on-chain
verifier accepts the proof and rejects a tampered public input. The setup here is
for tests only; the production VK comes from an auditable multi-contributor
ceremony.

## Known caveats (pre-production)

- **Poseidon constants.** This increment compiles circomlib's Poseidon over the
  BLS12-381 field. The in-circuit hash and the witness generator are consistent by
  construction (both from the same compile), which is what the proof needs, but
  before the production trusted setup we pin BLS12-381-native Poseidon round
  constants.
