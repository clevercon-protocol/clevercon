# Private spending policies: commitment and proof protocol

**Status:** Frozen v1 (protocol version `pp/1`). Normative.
**Audience:** implementers of the vault, the on-chain verifier, the Noir circuit, and the off-chain prover; and security reviewers.

This document is the single source of truth for how a private spending policy is
committed, how a release is proven to comply with it, and how the proof is
verified on-chain. It uses **MUST / SHOULD / MAY** per RFC 2119. Where an
encoding is given, it is exact and testable, and [the worked example](#11-worked-example-canonical-fixture)
is the cross-implementation fixture.

The privacy layer spans four components that MUST agree byte-for-byte:

| Component | Role | Source |
|---|---|---|
| CleverVault (`agent-vault`) | Stores the policy commitment; calls the verifier before releasing funds; tracks the running-spend accumulator | `contracts/agent-vault` |
| policy-verifier | Pure on-chain check: proof + public inputs → `bool` | `contracts/policy-verifier` |
| spend-policy circuit | Proves a release obeys the private rule | `circuits/spend-policy` (Noir, built) |
| Prover client | Builds the commitment, generates the proof per release | `services/*` prover worker (to build) |

If any two disagree on the commitment, the public-input order/encoding, or the
nullifier derivation, proofs fail verification with no obvious cause. This spec
removes that ambiguity.

---

## 1. Design decisions (resolved here, once)

These are pinned so the other three components do not each decide independently.

- **Field.** All circuit-internal arithmetic is over the **BN-254 scalar field**
  `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
  This matches the UltraHonk / Noir target and CipherMit.
- **Circuit hash primitive.** The commitment, the allowlist Merkle tree, and the
  nullifier use a single BN-254 field hash `H`. **v1 uses `pedersen_hash`** (Noir
  stdlib-native); **Poseidon2 is the migration target** (to match the UltraHonk /
  CipherMit stack) once the external `poseidon` Noir library compiles against the
  pinned `nargo`. Either way `H(...)` is a field element `< p`, serialised as
  **32 bytes big-endian** (the top two bits are therefore always zero). The
  implemented circuit is `circuits/spend-policy`.
- **On-chain transcript hash.** The verifier binds the proof to its public inputs
  with **SHA-256** (the only cheap hash host function Soroban exposes). This is a
  *binding* check, not a full pairing; see [§7](#7-trust-and-threat-model).
- **Address to field.** A payee Stellar address is encoded for the public inputs
  as `SHA-256(payee_scval_xdr)`, the SHA-256 of the payee's Soroban `ScVal`
  (`SCV_ADDRESS`) XDR serialisation, i.e. `Address::to_xdr(env)` in the contract.
  The result is a full 32-byte value used verbatim as public input `PI₁`. When
  the **circuit** needs the payee as a field element it uses that same 32-byte
  value reduced modulo `p`.
- **`i128` to field.** An amount in **stroops** (1 USDC = 10,000,000 stroops) is
  encoded as `0x00 × 16 ‖ amount_u128.to_be_bytes()`, 16 zero bytes followed by
  the unsigned 128-bit big-endian amount, giving `PI₂` (32 bytes). Amounts MUST
  be `> 0` (the verifier returns `InvalidAmount` otherwise).
- **Boundaries are inclusive.** Every ceiling and cap comparison is `≤` (a
  release of exactly the ceiling is allowed). Stated once, applied everywhere.

---

## 2. Policy data model

A policy is a set of up to four **composable** rules. Each rule carries an
explicit `enabled` flag; a disabled rule MUST be provably neutral (it can neither
block a release nor weaken another active rule). All monetary fields are
**stroops** (`u128`). All addresses are field elements per [§1](#1-design-decisions-resolved-here-once).

| # | Rule | Fields | Meaning when enabled |
|---|---|---|---|
| R1 | **Per-payment ceiling** | `ceiling: u128` | `amount ≤ ceiling` |
| R2 | **Rolling cap over a window** | `cap: u128`, `window_secs: u64` | `running_spend_in_window + amount ≤ cap` |
| R3 | **Allowlist** | `root: Field` (Merkle root), depth `D` | `payee ∈ allowlist` (Merkle membership) |
| R4 | **Deny-list + threshold** | `entries: [Field; K]`, `threshold: u128` | `payee ∉ deny-list` **whenever** `amount ≥ threshold` |

Per-delegate sub-budgets are expressed as R2 keyed by the delegate identity (the
window cap applies to a specific delegate address rather than globally); the
delegate identity is a private witness bound into the commitment.

**Empty policy.** A policy with **no rule enabled** is **rejected at commit
time** by the vault; it MUST NOT be interpreted as "allow all". The circuit
enforces that at least one rule is enabled (`enabled_R1 ∨ … ∨ enabled_R4`).

**Disabled-rule neutrality.** For each rule the circuit MUST gate the constraint
with the `enabled` flag such that a disabled rule imposes no constraint AND
cannot be used to satisfy a different rule (no shared witnesses across rule
gates).

---

## 3. Commitment scheme

The commitment is the only representation of the policy that leaves the user's
device. The plaintext rule is **never** stored server-side unless the user
explicitly opts into `ruleSummary` (see `policies.ruleSummary`, nullable).

```
policy_encoding = enabled_flags (4 × 1 field, 0/1)
               ‖ R1.ceiling
               ‖ R2.cap ‖ R2.window_secs ‖ R2.delegate
               ‖ R3.root ‖ R3.depth
               ‖ R4.entries[0..K] ‖ R4.threshold
               ‖ version                       (field, = 1 for pp/1)

commitment = H( policy_encoding , salt )            (H = the circuit hash; v1 pedersen_hash)
```

- `salt` is a uniformly random field element (`≥ 128 bits` of entropy) generated
  on the user's device and kept private. It makes the commitment hiding: two
  identical policies produce different commitments.
- Field ordering above is **normative**. Every field is a BN-254 element;
  `u128`/`u64` values are the integer embedded directly (they are `< p`).
- The 32-byte big-endian serialisation of `commitment` is public input `PI₀` and
  is what the vault stores (`policies.commitment`, hex).

An auditor with the policy and salt MUST be able to recompute the identical 32
bytes.

---

## 4. Public-input encoding (byte-precise)

The verifier's ABI is fixed at **four** 32-byte public inputs, in this order:

| Index | Field | Encoding | Bytes |
|---|---|---|---|
| PI₀ | `commitment` | circuit-hash output (v1 pedersen), big-endian | 32 |
| PI₁ | `payee_hash` | `SHA-256(payee_scval_xdr)` | 32 |
| PI₂ | `amount_scalar` | `0x00 × 16 ‖ amount_u128.to_be_bytes()` | 32 |
| PI₃ | `nullifier` | circuit-hash output (v1 pedersen), big-endian ([§5](#5-nullifier-derivation)) | 32 |

The canonical **public-input vector** is the 128-byte concatenation
`PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃`. The **public-input commitment** carried in the proof
header is:

```
PI_hash = SHA-256( PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃ )
```

The prover MUST produce a proof whose embedded PI commitment equals this
`PI_hash`; a single-bit change to any input changes `PI_hash`, breaks the
Fiat-Shamir transcript challenge, and makes `verify` return `false`. This is the
mechanism that binds the proof to exactly one `(commitment, payee, amount,
nullifier)` tuple ([§6](#6-binding)).

The on-chain contract signature (`contracts/policy-verifier`):

```rust
pub fn verify(
    env: Env,
    commitment: BytesN<32>,   // PI0
    payee:      Address,      // hashed to PI1 inside verify
    amount:     i128,         // encoded to PI2 inside verify
    nullifier:  BytesN<32>,   // PI3
    proof:      Bytes,
) -> Result<bool, VerifierError>
```

`verify` reconstructs `PI₁` and `PI₂` itself from `payee` and `amount`, so a
caller cannot supply an inconsistent pre-hashed value.

---

## 5. Nullifier derivation

```
nullifier = H( commitment , payee_field , amount , spend_counter )   (H = the circuit hash; v1 pedersen_hash)
```

- `spend_counter` is a per-policy monotonically increasing witness (starting at
  0) supplied by the vault and bound into the proof. It guarantees two otherwise
  identical legitimate releases (same `payee`, same `amount`, same policy)
  produce **distinct** nullifiers.
- The verifier and vault treat `nullifier` as **spend-once**: the vault records
  each accepted nullifier (`proofs.nullifier` is `UNIQUE`) and rejects a repeat.
  This is the replay protection.
- The nullifier is derived from `commitment` (not the plaintext policy), so it is
  **unlinkable** to the rule: an observer sees only opaque 32-byte values and
  cannot recover the policy, the payee identity, or relate two spends to the same
  policy beyond what the payee/amount already reveal.

---

## 6. Binding

A proof is bound to a single release by construction:

1. `payee` and `amount` are public inputs, so the proof only verifies for the
   exact payee and amount it was generated for.
2. `PI_hash` mixes all four inputs into the Fiat-Shamir transcript; reusing the
   proof for a different payee/amount changes `PI_hash` and fails verification.
3. `nullifier` is spend-once, so even a correctly-formed proof cannot be
   replayed for a second release.

Consequently a hosted prover or a network observer cannot take a valid proof and
redirect the funds, inflate the amount, or double-spend it.

---

## 7. Trust and threat model

Stated honestly, including what is **not** hidden.

**What the design hides.** The spending rule itself (all of R1–R4 and their
thresholds), the salt, the allowlist membership set, and the per-delegate
sub-budget structure. None of these appear on-chain or in server storage (absent
explicit opt-in).

**What is public regardless.** The payee address and the amount of each release
are public inputs and therefore visible on-chain, the privacy guarantee is
about the *rule*, not the individual payments. The number of releases against a
commitment is observable.

**On-chain verifier is a binding check, not a full pairing.** Soroban exposes no
pairing host function, so `policy-verifier` v1 performs a host-accelerated
polynomial-binding check (SHA-256 transcript + opening-consistency), not a full
UltraHonk pairing verification. This **binds the proof to the exact public
inputs** and delegates circuit-specific soundness to the trusted circuit and
proving stack. It is honest to say: v1 trusts the proving stack for soundness of
the *predicate*; it does not trust it for *binding*. The migration to a full
pairing check (Stellar CAP-0058 precompiles) is ABI-compatible and changes only
the internal steps, not this spec. See `contracts/policy-verifier/README.md`.

**Hosted prover.** v1 may run the prover as a hosted worker, which therefore
sees the plaintext policy and salt for the policies it proves. This is a real
trust assumption. The roadmap's path is client-side / enclave proving so the
plaintext never leaves the user's control; the wire formats here do not change
when that lands.

**Rolling-window running total (R2).** v1 does **not** carry the plaintext
running total on-chain (that would leak spend). Because the verifier ABI is fixed
at four public inputs, v1 enforces R2 as **vault-assisted**: the vault maintains
a per-commitment cumulative-spend accumulator and supplies the prior running
spend to the circuit as an authenticated witness; the circuit proves
`running_spend + amount ≤ cap`. The fully-in-circuit private accumulator (old/new
accumulator commitments as additional public inputs) is a **v2** item and is
called out as a known limitation, not silently assumed.

---

## 8. Versioning

- This protocol is `pp/1`. The `version` field is bound into the commitment
  ([§3](#3-commitment-scheme)), so a commitment is intrinsically tied to a
  protocol version.
- The active verifying key is identified on-chain by `get_vk_hash()`
  (`SHA-256` of the VK). A circuit or VK change rotates the VK, changing
  `get_vk_hash`; proofs generated against the old VK then fail.
- A stored commitment created under an old VK/circuit whose VK has since been
  rotated MUST be treated as **stale**: the vault MUST reject a proof whose
  circuit version does not match the active VK, and the user re-commits under the
  new protocol version. Clients SHOULD surface the `get_vk_hash` mismatch rather
  than presenting an opaque verification failure.

---

## 9. Edge cases (normative)

| Case | Defined behaviour |
|---|---|
| Policy enables no rule | Rejected at commit; circuit asserts `≥ 1` rule enabled. |
| `amount` exactly equals a ceiling/cap | Allowed (inclusive `≤`). |
| `amount ≤ 0` | `verify` returns `Err(InvalidAmount)`. |
| Allowlist rule disabled | No membership constraint; MUST NOT become "anyone allowed" for other rules. |
| Deny-list with `amount < threshold` | Deny-list not enforced for that release (by design). |
| Two legitimate releases, identical `(payee, amount)` | Distinct nullifiers via `spend_counter`; both succeed once. |
| Replayed nullifier | Rejected (`proofs.nullifier` UNIQUE). |
| VK rotated after commit | Proof fails; treated as stale, re-commit required ([§8](#8-versioning)). |
| Proof `< 512` or `> 16384` bytes | `Err(InvalidProofLength)`. |
| VK not set | `Ok(false)` (fail-closed). |

---

## 10. Component responsibilities

- **Circuit** (`circuits/spend-policy`, #65): public inputs exactly
  `[commitment, payee, amount, nullifier]` per [§4](#4-public-input-encoding-byte-precise);
  proves `H(policy, salt) == commitment`, the enabled rules, and the
  nullifier derivation; inactive rules provably neutral. Ships golden
  `Prover.toml` / `Verifier.toml` + a generated proof/VK.
- **Verifier** (`contracts/policy-verifier`, #64): the `verify` ABI above; VK
  rotation via `set_vk`; `get_vk_hash` for versioning. Fail-closed per
  [§9](#9-edge-cases-normative).
- **Vault** (`contracts/agent-vault`, #63): stores `commitment`; `set_policy_verifier`
  and `release_payment_proved` call `verify` and only move funds on `true`;
  records nullifiers; maintains the R2 accumulator.
- **Prover** (#67): builds the commitment and salt, computes public inputs
  exactly as [§4](#4-public-input-encoding-byte-precise), generates the proof,
  and drives the `proofs` lifecycle (`REQUESTED → …`).

---

## 11. Worked example (canonical fixture)

A concrete release, computable by any implementation. `commitment` and
`nullifier` below are illustrative 32-byte field elements (in a real release they
are circuit-hash outputs (v1 pedersen) from the circuit); `payee_hash`, `amount_scalar`, and
`PI_hash` are computed exactly per this spec and are reproducible.

```
Release:
  payee   = GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ
  amount  = 1_500_000 stroops   (0.15 USDC)

Public inputs (hex, 32 bytes each):
  PI0 commitment   = 0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a
  PI1 payee_hash   = 3f8dde2a43b0e39285c73fa275da29bd739ac0a93049a60e98de0ac7f92faa2c
                     = SHA-256( ScVal(SCV_ADDRESS) XDR of the payee )
  PI2 amount_scalar= 000000000000000000000000000000000000000000000000000000000016e360
                     = 0x00×16 ‖ (1_500_000).to_be_bytes()   (0x16e360 = 1_500_000)
  PI3 nullifier    = 0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b

PI_hash = SHA-256( PI0 ‖ PI1 ‖ PI2 ‖ PI3 )
        = cad880678d1eac3ddba11b732ccfe41dd0596fecc5b603e1d9a63f1446999399
```

The payee `ScVal` XDR (base64) for cross-checking `PI₁`:
`AAAAEgAAAAAAAAAAPww0v5OtDZlx0EzMkPcFURyDiq2XNKSi+w16A/x/6Jo=`.

The **canonical golden vector** for the full `(VK, public_inputs, proof)` triple
ships in `contracts/policy-verifier/src/fixtures/vectors.rs` and is what the
circuit (#65) and prover (#67) MUST reproduce. The bytes above pin the
public-input layer independently of the proving stack.

---

## 12. Non-goals and known limitations

- v1 does not hide the payee or amount of a release (only the rule).
- v1's on-chain verifier is a binding check, not a full pairing verification.
- v1 may trust a hosted prover with plaintext policies.
- R2 (rolling window) is vault-assisted in v1; a fully in-circuit private
  accumulator is v2.
- These are stated so the privacy claim is not overstated. See
  [ROADMAP.md](../ROADMAP.md) "Private spending policies" and
  [docs/architecture.md](architecture.md) "Where it is headed".

---

## 13. Testnet validation (2026-09-10)

The full opt-in private-spending path was exercised end to end on Stellar
testnet, not just in unit tests:

- **policy-verifier** deployed at `CBILHCY4FEYU7RMWBHJX42QJ5TILHZ33HNOD7A6FXTXKB7X57N4LZQ2D`
  (admin set, VK installed: circuit_size 16384, 4 public inputs, offset 1).
- A binding proof produced by the TypeScript prover
  (`@clevercon/common` `buildBindingProof`) was **accepted** by the deployed
  contract: `verify_policy -> true`. A mismatched release (wrong amount)
  returned `false`. This is the authoritative cross-language check that the
  off-chain prover and the on-chain verifier agree byte for byte.
- A CleverVault instance bound a task to a policy commitment
  (`create_task_with_policy`), was pointed at the verifier
  (`set_policy_verifier`), and a proof-gated release
  (`release_payment_proved`) **moved real funds** (20 XLM to the payee) only
  after the cross-contract `verify_policy` returned `true`.
- Negative control: a release presented with a proof for a different amount was
  **rejected** (verifier `false` -> vault `PolicyProofRejected`), and no funds
  moved.

Reproduce the proof bytes with `scripts/build-test-proof.mjs`. The binding
check, not a full pairing verification, is what runs on-chain (section 7); the
UltraHonk compliance proof remains the trusted off-chain artifact in v1.
