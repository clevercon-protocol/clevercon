//! Test vectors for the policy-verifier contract.
//!
//! These fixtures form the canonical cross-test suite shared with:
//!   - `contracts/agent-vault` (#63 — vault calls `verify` before releasing funds)
//!   - Orchestrator proof lifecycle (#67 — prover client produces compatible proofs)
//!
//! # How the vectors were constructed
//!
//! The proof wire format follows the host-accelerated verification protocol
//! in `src/verifier.rs`.  The construction algorithm is:
//!
//! 1. Choose `commitment`, `payee_xdr_bytes`, `amount`, `nullifier`.
//! 2. Compute `PI_hash = SHA-256(PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃)` per encoding.rs.
//! 3. Set `pi_commitment = PI_hash` (bytes [0..32] of proof).
//! 4. Set `circuit_id` = SHA-256("clevercon-spend-policy-v1") (bytes [32..64]).
//! 5. Compute `selector_evals_hash` = SHA-256("sel-evals-placeholder") [128..160].
//! 6. Compute `challenge_zeta` = SHA-256(circuit_id ‖ PI_hash ‖ selector_evals_hash).
//! 7. Compute `grand_product_eval` = SHA-256("gp-eval-placeholder") [96..128].
//! 8. Compute `linearisation_eval` = SHA-256(ζ ‖ grand_product_eval) [64..96].
//! 9. Choose `shifted_opening_eval` = SHA-256("shifted-eval-placeholder") [192..224].
//! 10. Find `opening_eval` such that `check_opening_consistency` returns true.
//!     The sentinel is: `SHA-256(ζ ‖ opening_eval ‖ shifted ‖ domain_tag)[0] == 0x00`.
//!     We brute-force the last byte of `opening_eval` until the sentinel is met.
//!     (This is only needed for test vector construction; valid proofs from the
//!     real Noir prover satisfy the full equation.)
//! 11. Pad to MIN_PROOF_LEN with zeroes.
//!
//! The matching VK contains:
//!   - `circuit_size = 16384` (2¹⁴, big-endian u32 = 0x00004000)
//!   - `num_public_inputs = 4` (big-endian u32 = 0x00000004)
//!   - `pub_inputs_offset = 1` (big-endian u32 = 0x00000001)
//!   - 52 remaining bytes of selector commitment placeholder (zeroed)

/// The verifying key bytes for the spend-policy circuit (circuit_size = 16384).
///
/// Format: [circuit_size: u32 be] [num_public_inputs: u32 be]
///          [pub_inputs_offset: u32 be] [52 bytes placeholder commitments]
pub const VALID_VK: &[u8] = &[
    // circuit_size = 16384 = 0x00004000
    0x00, 0x00, 0x40, 0x00, // num_public_inputs = 4
    0x00, 0x00, 0x00, 0x04, // pub_inputs_offset = 1
    0x00, 0x00, 0x00, 0x01, // 52 bytes of selector commitment placeholder (zeroed)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
];

/// Public input values for the valid test vector.
///
/// These must be passed verbatim to `verify()` for the proof to check out.
pub const COMMITMENT: [u8; 32] = [
    0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89,
    0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89,
];

/// Amount in stroops for the valid test vector (1 USDC = 10_000_000 stroops).
pub const AMOUNT: i128 = 10_000_000;

/// Nullifier for the valid test vector.
pub const NULLIFIER: [u8; 32] = [
    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00,
    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00,
];

/// Circuit-domain separator: SHA-256("clevercon-spend-policy-v1").
///
/// Used as `circuit_id` in the proof header and in the Fiat-Shamir transcript.
/// Both the on-chain verifier and the Noir prover (#67) must use this string.
pub const CIRCUIT_DOMAIN_SEP: &[u8] = b"clevercon-spend-policy-v1";

/// Build a minimal valid proof for the given public-input hash.
///
/// This constructs proof bytes that will pass `verify_proof` in `verifier.rs`.
/// The construction follows the 11-step protocol in the module doc comment.
///
/// # Arguments
/// * `env`     – Soroban execution environment.
/// * `pi_hash` – 32-byte public-input commitment from `build_public_inputs`.
///
/// # Returns
/// A `soroban_sdk::Bytes` that will pass verification with `VALID_VK`.
pub fn build_valid_proof(
    env: &soroban_sdk::Env,
    pi_hash: &soroban_sdk::BytesN<32>,
) -> soroban_sdk::Bytes {
    use soroban_sdk::{Bytes, BytesN};

    // circuit_id = SHA-256("clevercon-spend-policy-v1")
    let circuit_domain = Bytes::from_slice(env, CIRCUIT_DOMAIN_SEP);
    let circuit_id: BytesN<32> = env.crypto().sha256(&circuit_domain).into();

    // selector_evals_hash = SHA-256("sel-evals-placeholder")
    let sel_placeholder = Bytes::from_slice(env, b"sel-evals-placeholder");
    let selector_evals_hash: BytesN<32> = env.crypto().sha256(&sel_placeholder).into();

    // challenge_zeta = SHA-256(circuit_id ‖ PI_hash ‖ selector_evals_hash)
    let mut transcript = Bytes::new(env);
    transcript.extend_from_array(&circuit_id.to_array());
    transcript.extend_from_array(&pi_hash.to_array());
    transcript.extend_from_array(&selector_evals_hash.to_array());
    let challenge_zeta: BytesN<32> = env.crypto().sha256(&transcript).into();

    // grand_product_eval = SHA-256("gp-eval-placeholder")
    let gp_placeholder = Bytes::from_slice(env, b"gp-eval-placeholder");
    let grand_product_eval_bn: BytesN<32> = env.crypto().sha256(&gp_placeholder).into();
    let grand_product_eval = grand_product_eval_bn.to_array();

    // linearisation_eval = SHA-256(ζ ‖ grand_product_eval)
    let mut lin_data = Bytes::new(env);
    lin_data.extend_from_array(&challenge_zeta.to_array());
    lin_data.extend_from_array(&grand_product_eval);
    let lin_eval_bn: BytesN<32> = env.crypto().sha256(&lin_data).into();
    let linearisation_eval = lin_eval_bn.to_array();

    // shifted_opening_eval = SHA-256("shifted-eval-placeholder")
    let shifted_placeholder = Bytes::from_slice(env, b"shifted-eval-placeholder");
    let shifted_bn: BytesN<32> = env.crypto().sha256(&shifted_placeholder).into();
    let shifted_opening_eval = shifted_bn.to_array();

    // Find opening_eval such that check_opening_consistency returns true.
    // Sentinel: SHA-256(ζ ‖ opening_eval ‖ shifted ‖ domain_tag)[0] == 0x00
    // domain_tag = log_circuit_size(16384)=14 as u32 be ‖ pub_inputs_offset=1 as u32 be
    let log_circuit_size: u32 = 14; // log2(16384)
    let pub_inputs_offset: u32 = 1;

    let mut opening_eval = [0u8; 32];
    for candidate in 0u8..=255 {
        opening_eval[31] = candidate;
        let mut check_data = Bytes::new(env);
        check_data.extend_from_array(&challenge_zeta.to_array());
        check_data.extend_from_array(&opening_eval);
        check_data.extend_from_array(&shifted_opening_eval);
        check_data.extend_from_array(&log_circuit_size.to_be_bytes());
        check_data.extend_from_array(&pub_inputs_offset.to_be_bytes());
        let check: BytesN<32> = env.crypto().sha256(&check_data).into();
        if check.to_array()[0] == 0x00 {
            break;
        }
    }

    // Assemble proof bytes: 224-byte header + padding to 512 bytes
    let mut proof_bytes = [0u8; 512];
    proof_bytes[0..32].copy_from_slice(&pi_hash.to_array());
    proof_bytes[32..64].copy_from_slice(&circuit_id.to_array());
    proof_bytes[64..96].copy_from_slice(&linearisation_eval);
    proof_bytes[96..128].copy_from_slice(&grand_product_eval);
    proof_bytes[128..160].copy_from_slice(&selector_evals_hash.to_array());
    proof_bytes[160..192].copy_from_slice(&opening_eval);
    proof_bytes[192..224].copy_from_slice(&shifted_opening_eval);
    // [224..512) zeroed padding

    Bytes::from_slice(env, &proof_bytes)
}
