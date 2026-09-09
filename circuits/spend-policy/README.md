# `spend-policy` (Noir circuit)

Proves a release of `amount` to `payee` obeys a **private** spending policy whose
hash equals the public `commitment`, emitting a `nullifier` that binds the proof
to a single spend. Implements the four composable rule types from
[docs/private-policies.md](../../docs/private-policies.md).

## Public inputs

`commitment`, `payee`, `amount`, `nullifier` (see spec section 4). Everything
else, the rules, the salt, the running spend, the allow/deny lists, is a private
witness.

## Rules (composable; inactive rules are provably neutral)

| Rule | Enforced when enabled |
|------|-----------------------|
| R1 per-payment ceiling | `amount <= ceiling` (inclusive) |
| R2 rolling cap | `running_spend + amount <= cap` (inclusive); `running_spend` is a vault-supplied witness |
| R3 allowlist | `payee` is a Poseidon/Pedersen Merkle-tree member (depth 4) |
| R4 deny-list + threshold | when `amount >= threshold`, `payee` is not in the deny-list |

At least one rule must be enabled (an empty policy is rejected, never "allow
all"). The commitment binds all rule fields + a version + the salt; the nullifier
is `hash(commitment, payee, amount, spend_counter)`.

## Hash primitive (v1)

v1 uses the Noir stdlib **`pedersen_hash`** for the commitment, the Merkle tree,
and the nullifier. The frozen spec's original target was Poseidon2 (to match the
UltraHonk / CipherMit stack); the external `poseidon` Noir library does not yet
compile against the pinned `nargo` (1.0.0-beta.26), so v1 ships on the
stdlib-native Pedersen hash and Poseidon2 is a documented migration once the
library and compiler versions align. The on-chain verifier's SHA-256 public-input
binding (spec section 4) is independent of this choice.

Amounts are compared as `u64` stroops in-circuit (realistic USDC amounts fit);
the spec's `u128` wire encoding is unchanged and widening the comparison type is
a v2 item.

## Build, test, prove

```bash
export PATH="$HOME/.nargo/bin:$PATH"
nargo check    # type-check + generate Prover.toml
nargo test     # run the constraint tests (accept/reject vectors)
nargo info     # circuit size (main: ~371 ACIR opcodes)

# Proof + verifying key generation needs barretenberg (bb):
#   bbup            # install bb
#   nargo execute   # produce the witness
#   bb prove -b ./target/spend_policy.json -w ./target/spend_policy.gz -o ./proof
#   bb write_vk -b ./target/spend_policy.json -o ./vk
```

The `#[test]` functions in `src/main.nr` are the golden vectors: they build a
witness, derive the commitment/nullifier the same way the circuit does, and
assert the circuit accepts (valid) or rejects (over-ceiling, over-cap, denied
payee, wrong commitment, empty policy). `nargo test` reports 9 passing.

## Tradeoffs

- Allowlist Merkle depth is fixed at 4 (16 leaves). Deeper trees allow more
  approved payees at a higher per-proof gate cost; depth is committed so the
  verifier and prover agree.
- Deny-list length is fixed at 4 entries. Both are compile-time globals in
  `src/main.nr`.
