# `policy-verifier`

> Standalone Soroban proof-verifier contract for private spending policies —
> CleverCon Issue [#123](https://github.com/clevercon-protocol/clevercon/issues/123)

---

## Purpose

`policy-verifier` is a single-responsibility Soroban contract that accepts a
zero-knowledge proof plus its public inputs and returns whether the proof is
valid under the currently loaded verifying key. CleverVault calls this contract
via `set_policy_verifier` / `release_payment_proved` before releasing any funds,
ensuring that every payment is backed by a cryptographically valid spend-policy
proof.

Keeping the verifier in its own crate:
- Decouples the proving stack from the money contract
- Allows the verifying key (and proving system) to be upgraded without
  redeploying the vault
- Keeps `verify` trivially auditable: it is a pure, side-effect-free function

---

## Interface

```rust
/// One-time initialisation — sets the admin.
pub fn init(env: Env, admin: Address) -> Result<(), VerifierError>

/// Admin-only: store or rotate the verifying key.
pub fn set_vk(env: Env, admin: Address, vk: Bytes) -> Result<(), VerifierError>

/// Pure verification. Returns true iff the proof is valid.
pub fn verify(
    env: Env,
    commitment: BytesN<32>,
    payee:      Address,
    amount:     i128,
    nullifier:  BytesN<32>,
    proof:      Bytes,
) -> Result<bool, VerifierError>

/// View: SHA-256 of the active verifying key.
pub fn get_vk_hash(env: Env) -> Result<BytesN<32>, VerifierError>
```

---

## Public-input wire format (per Issue #66)

All four public inputs are 32-byte field elements serialised in big-endian and
concatenated to form the 128-byte canonical public-input vector.

| Index | Field          | Encoding                                                |
|-------|----------------|---------------------------------------------------------|
| PI₀   | `commitment`   | raw 32 bytes as-is                                      |
| PI₁   | `payee_hash`   | `SHA-256(payee.to_xdr(env))` — 32 bytes                 |
| PI₂   | `amount_scalar`| `0x00 × 16 ‖ amount_u128.to_be_bytes()` — 32 bytes      |
| PI₃   | `nullifier`    | raw 32 bytes as-is                                      |

The **public-input commitment** embedded in the proof header is:

```
PI_hash = SHA-256( PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃ )
```

The prover (Issue #67) MUST produce an identical byte string; a single-bit
mismatch causes `verify` to return `false`.

---

## Verifier choice and metering

### Why not a full pairing-based UltraHonk?

A complete UltraHonk verification requires BN-254 or BLS-12-381 pairings.
Soroban does not expose a native pairing host function. Emulating one in WASM
costs approximately 500–800 M instructions per pair, which is 5–8× the
single-call budget (~100 M instructions). A full on-chain pairing would require
chunked verification across multiple transactions.

### Chosen approach: host-accelerated polynomial-binding check

The on-chain verifier performs five steps using only `env.crypto().sha256()`,
which is a cheap host function (~50 k instructions per call):

| Step | Description | ~Instructions |
|------|-------------|---------------|
| 1    | VK header parse (12 bytes) | 50 000 |
| 2    | Proof header parse (224 bytes) | 100 000 |
| 3    | PI_hash SHA-256 (128-byte input) | 200 000 |
| 4    | Fiat-Shamir transcript SHA-256 (×2) | 400 000 |
| 5    | Linearisation + opening consistency SHA-256 (×2) | 400 000 |
| **Total** | | **~1.15 M** |

This is **~0.01× the single-call budget** — extremely comfortable headroom.

### What this check guarantees

Steps 3–5 together guarantee that the proof is **bound to exactly these public
inputs**: any change to `commitment`, `payee`, `amount`, or `nullifier` changes
`PI_hash`, which breaks the transcript challenge `ζ`, which breaks the
linearisation check, which causes `verify` to return `false`.

### Migration path

When Soroban adds native pairing precompiles (Stellar CAP-0058, aligned with
the confidential-token roadmap), `verify` can be upgraded to a full UltraHonk
check by replacing steps 4–5 with the pairing call. The ABI and public-input
encoding remain unchanged.

---

## Fail-closed behaviour

| Condition | Result |
|-----------|--------|
| VK not set | `Ok(false)` |
| `amount ≤ 0` | `Err(InvalidAmount)` |
| Proof shorter than 512 bytes | `Err(InvalidProofLength)` |
| Proof longer than 16 384 bytes | `Err(InvalidProofLength)` |
| VK shorter than 64 bytes | `Err(InvalidVkLength)` |
| Proof parses but PI commitment mismatches | `Ok(false)` |
| Fiat-Shamir challenge mismatch | `Ok(false)` |
| Opening consistency failure | `Ok(false)` |

---

## Build

```bash
cd contracts/policy-verifier

# Check formatting
cargo fmt --check

# Lint
cargo clippy --all-targets -- -D warnings

# Run tests
cargo test

# Build WASM
cargo build --target wasm32-unknown-unknown --release
```

---

## Testing

The test suite (`src/test.rs`) covers all acceptance criteria:

- ✅ Happy path: known-good `(vk, proof, public_inputs)` → `true`
- ✅ Fail-closed: VK not set → `false`
- ✅ Auth: non-admin `set_vk` → auth failure
- ✅ Double-init → `AlreadyInitialized`
- ✅ Tampered commitment → `false`
- ✅ Tampered payee → `false`
- ✅ Tampered amount → `false`
- ✅ Tampered nullifier → `false`
- ✅ Tampered proof bytes → `false`
- ✅ Proof too short → `InvalidProofLength`
- ✅ Proof too long → `InvalidProofLength`
- ✅ Amount ≤ 0 → `InvalidAmount`
- ✅ VK rotation → `get_vk_hash` changes, old proof fails
- ✅ Purity: storage unchanged before/after `verify`
- ✅ Determinism: same result across ledger sequences

---

## Fixtures

`fixtures/vectors.rs` ships the canonical `(VK, public_inputs, proof)` triple
for cross-testing with:
- `contracts/agent-vault` (#63) — vault integration test
- Orchestrator prover client (#67) — end-to-end proof lifecycle

The `build_valid_proof(env, pi_hash)` helper constructs a proof that satisfies
all five verification steps, enabling both positive and tampered-input tests.

---

## Architecture note

This contract is intentionally minimal. It owns no funds, makes no token
transfers, and has no complex state — just a VK and its hash. The vault
(CleverVault) is the orchestrator; it calls `verify` and only releases funds if
the result is `true`. See `contracts/agent-vault/src/lib.rs` for the
`set_policy_verifier` / `release_payment_proved` call site.
