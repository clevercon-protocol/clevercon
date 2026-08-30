#![no_std]
//! # `policy-verifier` — Standalone Soroban proof-verifier contract
//!
//! Single-responsibility contract that accepts a zero-knowledge proof plus its
//! public inputs and returns whether the proof is valid under the current
//! verifying key. CleverVault calls this contract via `set_policy_verifier` /
//! `release_payment_proved` before releasing any funds.
//!
//! ## Entrypoints
//!
//! | Function | Description |
//! |---|---|
//! | [`init`] | One-time initialisation; sets the admin. |
//! | [`set_vk`] | Admin-only; stores or rotates the verifying key. |
//! | [`verify`] | Pure verification call; returns `true` iff the proof is valid. |
//! | [`get_vk_hash`] | View; returns SHA-256 of the active VK for auditability. |
//!
//! ## Guarantees
//!
//! * **Pure / deterministic**: `verify` reads storage once (the VK) and makes
//!   no writes, no token calls, no cross-contract calls. Identical inputs
//!   always produce identical outputs.
//! * **Fail-closed**: if no VK has been set, `verify` returns `false`.
//! * **Typed errors**: malformed inputs return a `VerifierError` variant, not
//!   a panic, so the vault can distinguish a cryptographic failure from a
//!   configuration error.
//!
//! ## Wire format
//!
//! Public inputs are serialised per Issue #66:
//!
//! ```text
//! PI₀ = commitment        (32 bytes, raw)
//! PI₁ = SHA-256(payee XDR)(32 bytes)
//! PI₂ = amount            (32 bytes, big-endian u128: 16 zero ‖ 16-byte amount)
//! PI₃ = nullifier         (32 bytes, raw)
//! PI_hash = SHA-256(PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃)
//! ```

extern crate alloc;

mod encoding;
mod error;
mod types;
mod verifier;

#[cfg(test)]
pub mod fixtures;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, log, Address, Bytes, BytesN, Env};

use crate::{
    encoding::build_public_inputs,
    error::VerifierError,
    types::{DataKey, MAX_VK_LEN, MIN_VK_LEN},
    verifier::verify_proof,
};

#[contract]
pub struct PolicyVerifier;

#[contractimpl]
impl PolicyVerifier {
    /// One-time initialisation — stores the admin address.
    ///
    /// Panics if called more than once.
    ///
    /// # Arguments
    /// * `admin` — The address authorised to call `set_vk`. `admin.require_auth()`
    ///   is called, so the transaction must be signed by the admin key.
    pub fn init(env: Env, admin: Address) -> Result<(), VerifierError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VerifierError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        log!(&env, "PolicyVerifier initialised, admin={}", admin);
        Ok(())
    }

    /// Store or rotate the verifying key for the spend-policy circuit.
    ///
    /// Only the stored admin may call this function. The VK is validated for
    /// structural correctness (length bounds, power-of-two circuit size, and
    /// correct public-input count) before being stored.
    ///
    /// After a successful call, `get_vk_hash` reflects the new key.
    ///
    /// # Arguments
    /// * `admin` — Must be the address supplied to `init`. `admin.require_auth()`
    ///   is enforced.
    /// * `vk`    — Raw verifying key bytes as produced by `nargo compile` for
    ///             the spend-policy circuit (#65).
    pub fn set_vk(env: Env, admin: Address, vk: Bytes) -> Result<(), VerifierError> {
        admin.require_auth();

        // Authorisation check
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VerifierError::Unauthorized);
        }

        // Length sanity check before storing
        let len = vk.len();
        if !(MIN_VK_LEN..=MAX_VK_LEN).contains(&len) {
            return Err(VerifierError::InvalidVkLength);
        }

        // Structural validation (parse header; also validates num_public_inputs == 4)
        verifier::parse_vk(&vk).map_err(|_| VerifierError::MalformedVk)?;

        // Compute and cache the VK hash for `get_vk_hash`
        let vk_hash: BytesN<32> = env.crypto().sha256(&vk).into();

        env.storage().persistent().set(&DataKey::VerifyingKey, &vk);
        env.storage().instance().set(&DataKey::VkHash, &vk_hash);

        log!(
            &env,
            "PolicyVerifier VK set: len={} hash={:?}",
            len,
            vk_hash
        );
        Ok(())
    }

    /// Verify a zero-knowledge proof for a private spending policy.
    ///
    /// **Pure**: reads the stored VK, performs computation, returns a result.
    /// No storage writes, no token calls, no cross-contract calls with side
    /// effects.
    ///
    /// Returns `true` iff the proof is valid. Returns `false` (not an error)
    /// for:
    /// * VK not yet set (fail-closed)
    /// * Proof that is correctly structured but cryptographically invalid
    /// * Public inputs that do not match the inputs committed in the proof
    ///
    /// Returns a typed [`VerifierError`] for structural rejections:
    /// * `InvalidProofLength` — proof bytes out of [MIN_PROOF_LEN, MAX_PROOF_LEN]
    /// * `InvalidAmount` — `amount` is ≤ 0
    /// * `MalformedProof` — proof bytes cannot be parsed
    ///
    /// # Arguments
    /// * `commitment` — 32-byte policy-hash committed when funds were locked.
    /// * `payee`      — Intended payment recipient.
    /// * `amount`     — Payment amount in stroops (must be > 0).
    /// * `nullifier`  — 32-byte replay-prevention ticket.
    /// * `proof`      — ZK proof bytes as produced by the prover (#67).
    pub fn verify(
        env: Env,
        commitment: BytesN<32>,
        payee: Address,
        amount: i128,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) -> Result<bool, VerifierError> {
        // Amount guard — amounts ≤ 0 are never valid payments.
        if amount <= 0 {
            return Err(VerifierError::InvalidAmount);
        }

        // Fail-closed: no VK → false.
        let vk_bytes: Bytes = match env.storage().persistent().get(&DataKey::VerifyingKey) {
            Some(v) => v,
            None => return Ok(false),
        };

        // Reconstruct the canonical public-input vector and its hash from the
        // call arguments. This is the same computation the prover (#67) runs
        // to produce the PI commitment embedded in the proof.
        let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, amount, &nullifier);

        // Delegate to the pure verification engine.
        verify_proof(&env, &vk_bytes, &pi_hash, &proof)
    }

    /// Return the SHA-256 hash of the currently active verifying key.
    ///
    /// The vault and UI can call this to confirm which circuit version is in
    /// force without fetching the full VK bytes. Panics with `VkNotSet` if
    /// `set_vk` has never been called.
    pub fn get_vk_hash(env: Env) -> Result<BytesN<32>, VerifierError> {
        env.storage()
            .instance()
            .get(&DataKey::VkHash)
            .ok_or(VerifierError::VkNotSet)
    }
}
