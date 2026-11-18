# Private spending policies v2: real on-chain proofs (pp/2)

**Status:** Design (protocol version `pp/2`). Normative for the v2 build.
**Supersedes:** the `pp/1` binding-check model in [private-policies.md](private-policies.md). pp/1 stays frozen and documented there; pp/2 is the production target.
**Audience:** implementers of the circuit, the on-chain verifier, the vault, and the client prover; and security reviewers.

pp/1 proved a release complied with a hidden rule, but the on-chain check was a
SHA-256 *binding* check that trusted the off-chain proving stack for soundness of
the predicate. pp/2 removes that trust: the proof is a **Groth16 proof over
BLS12-381**, verified by a **real pairing** on-chain (Soroban's native
`crypto::bls12_381`). The verifier is implemented and proven in CI
(`contracts/policy-verifier`, `verify_groth16`; the `zk-fixture` workflow accepts
a genuine proof and rejects a tampered one). This document defines the circuit and
wire formats that feed it.

The same four components must agree byte for byte:

| Component | Role | Source |
|---|---|---|
| spend-policy circuit | Proves a release (or batch) obeys the private rule | `circuits/spend-policy-g16` (circom, to build) |
| policy-verifier | On-chain Groth16/BLS12-381 pairing check -> `bool` | `contracts/policy-verifier` (`verify_groth16`, done) |
| CleverVault | Stores the commitment; calls the verifier before releasing; records nullifiers; keeps the R2 accumulator | `contracts/agent-vault` |
| Prover client | Builds the commitment, generates the proof per release | `@clevercon/agent-sdk` (client-side, to build) |

---

## 1. Design decisions (pinned for pp/2)

- **Curve / field.** All circuit arithmetic is over the **BLS12-381 scalar field**
  `r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001`
  (= 52435875175126190479447740508185965837690552500527637822603658699938581184513).
  This is the curve Soroban verifies natively, so the proof the user generates is
  checked by a real pairing on-chain. (`r - 1` big-endian is the `NEG_ONE_BE`
  constant already in `groth16.rs`.)
- **Proof system.** Groth16. One proof is `(A in G1, B in G2, C in G1)`,
  uncompressed: G1 = 96 bytes, G2 = 192 bytes. Public inputs are BLS12-381
  scalars, each **32 bytes big-endian, value `< r`**. The verifier's `ic` vector
  has length `public_inputs.len() + 1`.
- **Circuit hash `H`.** **Poseidon over the BLS12-381 scalar field** (the
  Filecoin/neptune parameterization, which is BLS12-381-native and widely
  deployed). `H(...)` is an `Fr` element, serialized **32 bytes big-endian**. The
  exact round constants/MDS are pinned in the circuit package when it is built.
  (pp/1 used BN-254 Pedersen; pp/2 cannot, since Pedersen/BabyJubjub is BN-254.)
- **No transcript-binding hash.** pp/1's `PI_hash = SHA-256(PI0..PI3)` existed only
  to bind the proof to its inputs for the binding check. Groth16 binds public
  inputs cryptographically through `vk_x`, so **pp/2 has no `PI_hash`**. Public
  inputs are passed to the verifier directly as scalars.
- **Address to field.** `payee_field = SHA-256(payee_scval_xdr) mod r`, where
  `payee_scval_xdr` is `Address::to_xdr(env)` of the payee's `ScVal` (`SCV_ADDRESS`),
  identical to pp/1 except reduced mod `r` (not `p`). The reduction is applied
  identically by the circuit and by the vault before `Fr::from_bytes`, so both
  sides derive the same scalar. SHA-256 is 256 bits and can exceed `r`; the mod-`r`
  reduction is mandatory and is a single conditional subtraction (`r > 2^254`).
- **Amount to field.** `amount_field = amount_u128` embedded directly, serialized
  `0x00 x 16 || amount_u128.to_be_bytes()` (32 bytes). `amount` is in **stroops**
  (1 USDC = 10,000,000 stroops), must be `> 0`, and is always `< r`.
- **Boundaries are inclusive.** Every ceiling/cap comparison is `<=`.

---

## 2. Rule set (pp/2)

pp/2 keeps pp/1's four rules and adds the rules the real applications and the
agent economy need. Each rule has an `enabled` flag; a disabled rule is provably
neutral (gated so it neither blocks a release nor satisfies another rule). At
least one rule must be enabled (an empty policy is rejected at commit, never
"allow all").

| # | Rule | Fields | Meaning when enabled | Application |
|---|---|---|---|---|
| R1 | Per-payment ceiling | `ceiling` | `amount <= ceiling` | all |
| R2 | Rolling cap over a window | `cap`, `window_secs` | `running_spend + amount <= cap` | payroll, allowance |
| R3 | Allowlist (deep) | `root`, depth `D = 16` | `payee in allowlist` (Merkle membership, 65,536 payees) | payroll, disbursement, approved providers |
| R4 | Deny-list + threshold | `entries[K]`, `threshold` | `payee not in deny-list` whenever `amount >= threshold` | compliance |
| R5 | Per-payee limit | allowlist leaf carries `payee_cap` | for the proven payee, `amount <= payee_cap` | payroll, bounty tiers, per-provider caps |
| R6 | Calendar window | `[start, end]` list; public `[valid_after, valid_before]` | the validity window sits inside some calendar window | scheduled payroll, grants |
| R7 | Velocity (count cap) | `max_count`, `window_secs` | `releases_in_window + active <= max_count` | agent rate-limit, metered service calls |
| R8 | Per-category limit | leaf carries `payee_category`, `cat_ceiling[C]` | for the payee's category, `amount <= cat_ceiling[payee_category]` | service-marketplace budgets by category |

**The allowlist leaf (R3/R5/R8).** The leaf is `H(payee_field, payee_cap,
payee_category)`. Proving membership (R3) therefore also binds the payee's
individual cap (R5) and category (R8) without revealing the roster. R5 asserts
`amount <= payee_cap`; R8 looks up `cat_ceiling[payee_category]` (a small fixed set
of `C` categories) and asserts `amount <= cat_ceiling[payee_category]`. A disabled rule uses a
neutral value (cap/ceiling 0 with the check gated off). This is how one policy can
say "employee A up to 2,000, employee B up to 5,000" (R5) or "any data-service
call up to 50, any compute-service call up to 200" (R8), privately.

**R7 (velocity)** caps the *number* of releases in a window, independent of
amount, so an autonomous agent cannot drain a budget through many small legitimate
payments and metered per-call service spend can be rate-limited. Like R2 it is
vault-assisted: the vault keeps a per-commitment release-count accumulator and the
circuit proves `prior_count + active_releases <= max_count`.

**R6 (calendar)** cannot pin an exact settlement time into the proof (ledger time
advances between proving and settlement). Instead the prover picks a validity
window `[valid_after, valid_before]` (public inputs), the circuit proves that
window sits inside some committed calendar window (`valid_after >= start_w` and
`valid_before <= end_w` for some `w`, with the windows bound to `R6.windows_root`),
and the **vault** checks `valid_after <= ledger_time <= valid_before` at settlement.
This reveals only the chosen sub-window, never the full calendar.

**Batch disbursement.** One proof may authorize `N` releases (e.g., pay 50 bounty
winners at once) instead of one. The circuit proves every tuple
`(payee_i, amount_i)` obeys the per-release rules (R1/R3/R4/R5/R8) and that the
batch obeys the aggregate rules (`sum(amount_i) + running_spend <= cap` for R2,
`active_count` for R7), and derives `N` independent nullifiers. An `active` flag
marks real releases so a partially filled batch's null slots are provable no-ops
(nullifier 0, the vault skips them). Public inputs scale to `N` payees / amounts /
nullifiers (see section 4). `N` is fixed per compiled circuit (a small set of
sizes, e.g., 1, 8, 64); the vault picks the smallest that fits. This is the
headline feature for GrantFox-style disbursement and payroll.

**Selective disclosure (optional).** A policy MAY carry a public `category` tag
(e.g., a hash of "payroll") so a release can prove "this payment is governed by a
payroll policy" for audit, without revealing amounts or the roster. The tag is an
extra public input the prover opts into; absent opt-in it is a fixed constant.

### Build increments

The circuit lands in increments so each is CI-proven against the verifier before
the next:

1. **g16-single**: R1 + R3 (depth 16) + R5, single payment, 4 public inputs.
   Matches today's policy UI plus per-payee limits. (proven)
2. **g16-batch**: the above for `N` releases, batched public inputs; per-release
   R1/R3/R5 + N nullifiers + null-slot `active` flag. (proven)
3. **g16-accumulator**: R2 (rolling cap) and R7 (velocity), which share the
   vault-assisted accumulator mechanism; plus the aggregate batch checks.
4. **g16-extras**: R8 per-category limit (leaf + category selector), R4 deny-list,
   R6 calendar windows, selective-disclosure tag.

---

## 3. Commitment scheme (pp/2)

The commitment is the only representation of the policy that leaves the device.

```
policy_encoding = enabled_flags            (8 x Fr, 0/1: R1..R8)
               || R1.ceiling
               || R2.cap || R2.window_secs || R2.delegate
               || R3.root || R3.depth
               || R4.entries[0..K] || R4.threshold
               || R6.windows_root                    (Merkle/hash of calendar windows)
               || R7.max_count || R7.window_secs
               || R8.cat_ceiling[0..C-1]             (per-category ceilings)
               || disclosure_tag                     (selective-disclosure tag, else 0)
               || version                            (Fr, = 2 for pp/2)

commitment = H( policy_encoding, salt )              (H = Poseidon/BLS12-381)
```

The per-payee cap (R5) and category (R8) are not top-level fields: they live
inside the R3 allowlist leaves (`H(payee_field, payee_cap, category)`), so the
roster size never leaks through the encoding length.

- `salt` is a uniformly random `Fr` (`>= 128 bits` entropy), device-generated,
  kept private; it makes the commitment hiding.
- Field ordering is normative. `u128`/`u64` values embed directly (all `< r`).
- The 32-byte big-endian `commitment` is public input `PI0` and is what the vault
  stores (`policies.commitment`, hex).

An auditor with the policy and salt recomputes the identical 32 bytes.

---

## 4. Public-input layout (Groth16)

Public inputs are an ordered vector of `Fr` scalars (32-byte BE each), passed to
`verify_groth16` as `public_inputs`. `ic.len()` is this length `+ 1`.

**Single release (`g16-single`), 4 inputs:**

| Index | Field | Encoding |
|---|---|---|
| 0 | `commitment` | Poseidon output, BE |
| 1 | `payee_field` | `SHA-256(payee_xdr) mod r` |
| 2 | `amount_field` | `0x00 x 16 || amount_u128` |
| 3 | `nullifier` | Poseidon output, BE (section 5) |

**Batch release (`g16-batch`), `1 + 3N` inputs:** `commitment`, then for each
`i in 0..N`: `payee_field_i`, `amount_field_i`, `nullifier_i`. Unused slots in a
partially-filled batch are set to a canonical "null release" (`payee_field = 0`,
`amount = 0`) that the circuit proves is a no-op and the vault skips.

There is no `PI_hash`. The pairing check `e(A,B)*e(-alpha,beta)*e(-vk_x,gamma)*
e(-C,delta) == 1`, with `vk_x = IC[0] + sum(public_i * IC[i+1])`, is what binds
the proof to exactly these inputs. Changing any public input changes `vk_x` and
the proof fails. The on-chain `verify_groth16` is pure and fail-closed (returns
`false` on any length mismatch or a failing pairing).

The vault reconstructs `payee_field` and `amount_field` itself from the real
`Address` and `i128` it is about to pay, so a caller cannot submit a proof bound
to a different payee or amount than the funds movement.

---

## 5. Nullifier derivation (pp/2)

```
nullifier_i = H( commitment, payee_field_i, amount_field_i, spend_counter_i )
```

- `spend_counter` is a per-policy monotonic witness supplied by the vault, so two
  otherwise-identical legitimate releases produce distinct nullifiers. In a batch,
  each release uses a distinct counter.
- Spend-once: the vault records each accepted nullifier (`proofs.nullifier`
  UNIQUE) and rejects repeats. This is replay protection.
- Derived from `commitment` (not the plaintext policy), so nullifiers are
  unlinkable to the rule.

---

## 6. Trust and threat model (pp/2 vs pp/1)

**What changes.** The on-chain check is now a **real Groth16 pairing**, not a
binding check. Soundness of the predicate is enforced cryptographically on-chain,
not delegated to a trusted proving stack. This is the core pp/2 upgrade and the
reason it is strictly stronger than pp/1.

**What the design hides.** The rule itself (all of R1..R8, thresholds, per-payee
caps, per-category ceilings, velocity limits), the salt, the allowlist roster (and
each payee's cap and category), and the calendar. None appear on-chain or
server-side (absent explicit `ruleSummary` opt-in).

**What is public regardless.** The payee and amount of each release are public
inputs and visible on-chain; the privacy guarantee is about the *rule*, not the
individual payments. The number of releases against a commitment is observable; a
batch collapses `N` releases into one transaction, which *reduces* that leakage
versus `N` separate releases.

**Prover location.** The prover is **client-side** in `@clevercon/agent-sdk`
(the SDK generates the Groth16 proof on the owner's/agent's machine), so the
plaintext policy and salt never leave the user's control. There is no hosted
plaintext-prover trust assumption in pp/2.

**Accumulated rules (R2, R7).** As in pp/1, neither the plaintext running total
(R2) nor the running release count (R7) is put on-chain. The vault keeps a
per-commitment accumulator and supplies the prior value as an authenticated
witness; the circuit proves `running_spend + amount <= cap` (R2) and
`prior_count + active <= max_count` (R7). These land together in the
`g16-accumulator` increment since they share the mechanism. A fully in-circuit
private accumulator (old/new accumulator commitments as extra public inputs) is a
later hardening step.

**Trusted setup.** Groth16 needs a per-circuit trusted setup (a Powers-of-Tau
phase-1 plus a circuit-specific phase-2). pp/2 uses a public, auditable multi-
contributor ceremony for the production VK; the VK hash is pinned on-chain via
`set_vk`/`get_vk_hash`. CI uses a throwaway single-contributor setup for tests
only (never the production VK).

---

## 7. Versioning and migration

- `version = 2` is bound into the commitment, so a commitment is intrinsically
  pp/2. The active VK is identified on-chain by `get_vk_hash()`.
- A pp/1 commitment is **not** verifiable under the pp/2 VK (different curve and
  hash). Migration is a re-commit: the user creates a fresh pp/2 commitment from
  the same rule. The vault rejects a proof whose circuit version does not match the
  active VK and surfaces the `get_vk_hash` mismatch rather than an opaque failure.
- Each batch size `N` is a distinct compiled circuit with its own VK; the verifier
  holds one VK per registered size, and the vault selects by `N`.

---

## 8. Component responsibilities (pp/2)

- **Circuit** (`circuits/spend-policy-g16`): public inputs exactly per section 4;
  proves `H(policy, salt) == commitment`, the enabled rules (R1..R8), per-payee
  caps and categories (R5/R8), and each nullifier; inactive rules provably neutral;
  batch no-op slots provably neutral. Ships the circom source, the phase-2
  artifacts, and a golden proof/VK per size.
- **Verifier** (`contracts/policy-verifier`): `verify_groth16(vk, proof,
  public_inputs) -> bool` (done, CI-proven); `set_vk`/`get_vk_hash` for VK rotation
  per size; fail-closed.
- **Vault** (`contracts/agent-vault`): stores `commitment`; `release_payment_proved`
  and `release_payment_proved_batch` reconstruct the public inputs from the real
  payee/amount(s), call `verify_groth16`, move funds only on `true`, record
  nullifiers, and maintain the R2 accumulator.
- **Prover** (`@clevercon/agent-sdk`): builds the commitment and salt client-side,
  computes public inputs exactly per section 4, generates the Groth16 proof, and
  drives the `proofs` lifecycle.

---

## 9. Non-goals and honest limitations (pp/2)

- pp/2 still does not hide the payee or amount of a release (only the rule); a
  batch reduces, but does not eliminate, release-count leakage.
- Groth16 requires a trusted setup; soundness rests on at least one honest
  ceremony contributor. (A transparent-setup system, e.g. a STARK or a
  universal-setup SNARK, is a future consideration but is not budget-feasible on
  Soroban today; BLS12-381 Groth16 is.)
- The fully in-circuit private R2 accumulator is deferred.
- **Per-task scope (v1).** The vault records nullifiers and the R2/R7 accumulators
  per task (`TaskNullifier(task_id, ...)`, `running_spend = task.spent`,
  `TaskReleaseCount(task_id)`). So the once-only (replay) guarantee and the R2
  rolling cap / R7 velocity hold *within* a task, but reset across tasks: the same
  proof re-executed under a new task moves funds again, and the windowed caps do
  not span separate disburses. Per-release rules (R1, R3, R4, R5, R6, R8) are
  enforced in-proof on every release and are unaffected. The fix is vault-only (key
  the nullifier store and the accumulators by the policy commitment, not the task)
  and is scheduled for the security-hardening pass.
- These are stated so the privacy claim is not overstated.
