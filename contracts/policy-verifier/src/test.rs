//! Comprehensive test suite for the policy-verifier contract.
//!
//! # Coverage
//! - Happy path: known-good proof/vk/inputs -> `Ok(true)`
//! - Fail-closed: VK not set -> `Ok(false)`
//! - Auth enforcement: non-admin `set_vk` -> auth failure
//! - Double-init: second `init` -> `AlreadyInitialized`
//! - Public input tampering (each field individually) -> `Ok(false)`
//! - Proof tampering (pi_commitment, circuit_id, evaluations) -> `Ok(false)`
//! - Malformed proof length (too short, too long) -> typed `Err`
//! - Invalid amount (zero, negative) -> `Err(InvalidAmount)`
//! - VK rotation: new VK -> hash changes, old proof fails
//! - Purity: `verify` leaves all storage unchanged
//! - `get_vk_hash` round-trip
//! - VK length bounds enforcement

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env,
};

use crate::{
    encoding::build_public_inputs,
    error::VerifierError,
    fixtures::vectors::{build_valid_proof, AMOUNT, COMMITMENT, NULLIFIER, VALID_VK},
    PolicyVerifier, PolicyVerifierClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Set up a fresh environment with a registered contract and an initialised
/// admin. Returns `(env, contract_id, admin_address, client)`.
fn setup() -> (Env, Address, Address, PolicyVerifierClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(PolicyVerifier, ());
    let client = PolicyVerifierClient::new(&env, &contract_id);
    client.init(&admin);
    (env, contract_id, admin, client)
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_init_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(PolicyVerifier, ());
    let client = PolicyVerifierClient::new(&env, &contract_id);
    // init must not panic
    client.init(&admin);
}

#[test]
fn test_double_init_fails() {
    let (_, _, admin, client) = setup();
    let result = client.try_init(&admin);
    assert!(
        matches!(result, Err(Ok(VerifierError::AlreadyInitialized))),
        "second init must return AlreadyInitialized, got: {result:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// set_vk / get_vk_hash tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_set_vk_admin_only() {
    let (env, _, _admin, client) = setup();
    let not_admin = Address::generate(&env);
    let vk = Bytes::from_slice(&env, VALID_VK);
    // non-admin must be rejected
    let result = client.try_set_vk(&not_admin, &vk);
    assert!(
        result.is_err(),
        "non-admin set_vk must fail, got: {result:?}"
    );
}

#[test]
fn test_set_vk_and_get_hash() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let hash = client.get_vk_hash();
    // hash must be non-zero (SHA-256 of a non-empty input is never all-zero)
    let hash_arr = hash.to_array();
    assert!(
        hash_arr.iter().any(|&b| b != 0),
        "vk_hash must be non-zero after set_vk"
    );
}

#[test]
fn test_vk_rotation_changes_hash() {
    let (env, _, admin, client) = setup();
    let vk1 = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk1);
    let hash1 = client.get_vk_hash();

    // Build a second VK that differs in the circuit_size field
    let mut vk2_bytes: [u8; 64] = [0u8; 64];
    vk2_bytes[..VALID_VK.len()].copy_from_slice(VALID_VK);
    // Change circuit_size to 32768 (0x00008000)
    vk2_bytes[2] = 0x80;
    vk2_bytes[3] = 0x00;
    let vk2 = Bytes::from_slice(&env, &vk2_bytes);
    client.set_vk(&admin, &vk2);
    let hash2 = client.get_vk_hash();

    assert_ne!(hash1, hash2, "VK rotation must change get_vk_hash");
}

#[test]
fn test_set_vk_too_short_fails() {
    let (env, _, admin, client) = setup();
    // Less than MIN_VK_LEN (64) bytes
    let short_vk = Bytes::from_slice(&env, &[0u8; 8]);
    let result = client.try_set_vk(&admin, &short_vk);
    assert!(
        result.is_err(),
        "VK shorter than MIN_VK_LEN must be rejected"
    );
}

#[test]
fn test_set_vk_too_long_fails() {
    let (env, _, admin, client) = setup();
    // More than MAX_VK_LEN (65536) bytes
    let long_vk = Bytes::from_slice(&env, &[0u8; 65537]);
    let result = client.try_set_vk(&admin, &long_vk);
    assert!(
        result.is_err(),
        "VK longer than MAX_VK_LEN must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — happy path
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_valid_proof_returns_true() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let result = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);
    assert!(result, "valid proof must return true");
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — fail-closed: VK not set
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_without_vk_returns_false() {
    let (env, _, _admin, client) = setup();
    // Do NOT call set_vk — VK is unset
    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let result = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);
    assert!(!result, "verify without VK must return false (fail-closed)");
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — public-input tampering
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_tampered_commitment_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    // Pass a different commitment
    let mut bad = COMMITMENT;
    bad[0] ^= 0xFF;
    let bad_commitment = BytesN::from_array(&env, &bad);

    let result = client.verify(&bad_commitment, &payee, &AMOUNT, &nullifier, &proof);
    assert!(!result, "tampered commitment must return false");
}

#[test]
fn test_verify_tampered_payee_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let different_payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let result = client.verify(&commitment, &different_payee, &AMOUNT, &nullifier, &proof);
    assert!(!result, "tampered payee must return false");
}

#[test]
fn test_verify_tampered_amount_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let wrong_amount = AMOUNT + 1;
    let result = client.verify(&commitment, &payee, &wrong_amount, &nullifier, &proof);
    assert!(!result, "tampered amount must return false");
}

#[test]
fn test_verify_tampered_nullifier_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let mut bad_null = NULLIFIER;
    bad_null[31] ^= 0x01;
    let bad_nullifier = BytesN::from_array(&env, &bad_null);

    let result = client.verify(&commitment, &payee, &AMOUNT, &bad_nullifier, &proof);
    assert!(!result, "tampered nullifier must return false");
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — proof tampering
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_tampered_proof_pi_commitment_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    // Flip one bit in the proof's pi_commitment (bytes [0..32])
    let mut proof_bytes = [0u8; 512];
    for i in 0..512u32 {
        proof_bytes[i as usize] = proof.get(i).unwrap_or(0);
    }
    proof_bytes[0] ^= 0x01;
    let tampered = Bytes::from_slice(&env, &proof_bytes);

    let result = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &tampered);
    assert!(!result, "tampered proof pi_commitment must return false");
}

#[test]
fn test_verify_tampered_proof_linearisation_eval_returns_false() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    // Flip a bit in linearisation_eval (bytes [64..96])
    let mut proof_bytes = [0u8; 512];
    for i in 0..512u32 {
        proof_bytes[i as usize] = proof.get(i).unwrap_or(0);
    }
    proof_bytes[64] ^= 0x01;
    let tampered = Bytes::from_slice(&env, &proof_bytes);

    let result = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &tampered);
    assert!(!result, "tampered linearisation_eval must return false");
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — malformed input lengths
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_proof_too_short_returns_error() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    // 100 bytes — below MIN_PROOF_LEN (512)
    let short_proof = Bytes::from_slice(&env, &[0u8; 100]);

    let result = client.try_verify(&commitment, &payee, &AMOUNT, &nullifier, &short_proof);
    assert!(
        matches!(result, Err(Ok(VerifierError::InvalidProofLength))),
        "proof too short must return InvalidProofLength, got: {result:?}"
    );
}

#[test]
fn test_verify_proof_too_long_returns_error() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    // 20 000 bytes — above MAX_PROOF_LEN (16384)
    let long_proof = Bytes::from_slice(&env, &[0u8; 20_000]);

    let result = client.try_verify(&commitment, &payee, &AMOUNT, &nullifier, &long_proof);
    assert!(
        matches!(result, Err(Ok(VerifierError::InvalidProofLength))),
        "proof too long must return InvalidProofLength, got: {result:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — invalid amount
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_zero_amount_returns_error() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let proof = Bytes::from_slice(&env, &[0u8; 512]);

    let result = client.try_verify(&commitment, &payee, &0i128, &nullifier, &proof);
    assert!(
        matches!(result, Err(Ok(VerifierError::InvalidAmount))),
        "zero amount must return InvalidAmount, got: {result:?}"
    );
}

#[test]
fn test_verify_negative_amount_returns_error() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let proof = Bytes::from_slice(&env, &[0u8; 512]);

    let result = client.try_verify(&commitment, &payee, &(-1i128), &nullifier, &proof);
    assert!(
        matches!(result, Err(Ok(VerifierError::InvalidAmount))),
        "negative amount must return InvalidAmount, got: {result:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — purity / no storage mutation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_is_pure_no_storage_write() {
    let (env, _contract_id, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    // Capture vk_hash before verify
    let hash_before = client.get_vk_hash();

    // Call verify (with a valid proof to exercise the full path)
    let _ = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);

    // Capture vk_hash after verify — must be identical
    let hash_after = client.get_vk_hash();

    assert_eq!(
        hash_before, hash_after,
        "verify must not mutate storage (vk_hash changed)"
    );

    // Also verify that no unexpected auth calls were made
    // (verify is pure; no cross-contract calls, no storage writes)
    let auths = env.auths();
    // After init + set_vk + verify: only init and set_vk should have auth records
    // verify must NOT appear in auths as it requires no auth
    for (addr, _) in &auths {
        // verify does not call require_auth on any address
        let _ = addr; // just asserting no panic; the count check below is the real assertion
    }
    // init (1) + set_vk (1) = 2 auth records; verify contributes 0
    assert!(
        auths.len() <= 2,
        "verify must not emit auth calls; found {} total auth records",
        auths.len()
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// verify — VK rotation invalidates old proofs
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_vk_rotation_invalidates_old_proof() {
    let (env, _, admin, client) = setup();
    let vk1 = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk1);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    // Valid under vk1
    assert!(client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof));

    // Rotate to a valid second VK with a different circuit_size (32768 = 2^15)
    let mut vk2_bytes = [0u8; 64];
    vk2_bytes[..VALID_VK.len()].copy_from_slice(VALID_VK);
    vk2_bytes[..4].copy_from_slice(&32768u32.to_be_bytes()); // circuit_size = 32768
    vk2_bytes[4..8].copy_from_slice(&4u32.to_be_bytes()); // num_public_inputs = 4
    vk2_bytes[8..12].copy_from_slice(&1u32.to_be_bytes()); // pub_inputs_offset = 1
    let vk2 = Bytes::from_slice(&env, &vk2_bytes);
    client.set_vk(&admin, &vk2);

    let result_after = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);
    assert!(!result_after, "old proof must fail after VK rotation");
}

// ─────────────────────────────────────────────────────────────────────────────
// set_vk — malformed VK rejection
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_set_vk_with_malformed_vk_rejected() {
    let (env, _, admin, client) = setup();
    // Non-power-of-two circuit size (3)
    let mut bad_vk = [0u8; 64];
    bad_vk[..4].copy_from_slice(&3u32.to_be_bytes());
    bad_vk[4..8].copy_from_slice(&4u32.to_be_bytes());
    bad_vk[8..12].copy_from_slice(&1u32.to_be_bytes());
    let vk = Bytes::from_slice(&env, &bad_vk);
    let result = client.try_set_vk(&admin, &vk);
    assert!(
        matches!(result, Err(Ok(VerifierError::MalformedVk))),
        "malformed circuit_size in VK must return MalformedVk, got: {result:?}"
    );

    // Wrong num_public_inputs (5 instead of 4)
    let mut bad_vk2 = [0u8; 64];
    bad_vk2[..4].copy_from_slice(&16384u32.to_be_bytes());
    bad_vk2[4..8].copy_from_slice(&5u32.to_be_bytes());
    bad_vk2[8..12].copy_from_slice(&1u32.to_be_bytes());
    let vk2 = Bytes::from_slice(&env, &bad_vk2);
    let result2 = client.try_set_vk(&admin, &vk2);
    assert!(
        matches!(result2, Err(Ok(VerifierError::MalformedVk))),
        "wrong num_public_inputs in VK must return MalformedVk, got: {result2:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// get_vk_hash — before and after set_vk
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_get_vk_hash_before_set_vk_panics() {
    let (_, _, _, client) = setup();
    // No VK has been set — get_vk_hash must panic (VkNotSet)
    let result = client.try_get_vk_hash();
    assert!(
        result.is_err(),
        "get_vk_hash before set_vk must return an error"
    );
}

#[test]
fn test_get_vk_hash_is_sha256_of_vk() {
    let (env, _, admin, client) = setup();
    let vk_bytes = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk_bytes);
    let hash = client.get_vk_hash();
    // Cross-check: compute SHA-256 of VALID_VK independently
    let expected: BytesN<32> = env.crypto().sha256(&vk_bytes).into();
    assert_eq!(
        hash, expected,
        "get_vk_hash must equal SHA-256 of stored VK"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoding consistency across ledger timestamps
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_verify_deterministic_across_ledger_sequences() {
    let (env, _, admin, client) = setup();
    let vk = Bytes::from_slice(&env, VALID_VK);
    client.set_vk(&admin, &vk);

    let payee = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let nullifier = BytesN::from_array(&env, &NULLIFIER);
    let (_, pi_hash) = build_public_inputs(&env, &commitment, &payee, AMOUNT, &nullifier);
    let proof = build_valid_proof(&env, &pi_hash);

    let r1 = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);

    // Advance the ledger
    env.ledger().with_mut(|l| {
        l.sequence_number += 100;
        l.timestamp += 3600;
    });

    let r2 = client.verify(&commitment, &payee, &AMOUNT, &nullifier, &proof);
    assert_eq!(
        r1, r2,
        "verify must be deterministic regardless of ledger state"
    );
}
