//! Public-input serialisation — canonical encoding per #66.
//!
//! The verifier and prover must produce **identical** byte strings from the
//! same logical inputs. Any single-bit deviation causes verification to fail.
//!
//! # Wire format (128 bytes total, four 32-byte field elements)
//!
//! | Index | Field       | Source                                           | Encoding                                      |
//! |-------|-------------|--------------------------------------------------|-----------------------------------------------|
//! | PI₀   | commitment  | `BytesN<32>` passed directly                     | raw 32 bytes as-is                            |
//! | PI₁   | payee_hash  | `Address` → UTF-8/XDR bytes → SHA-256            | 32-byte hash                                  |
//! | PI₂   | amount_scalar | `i128` stroops                                 | 16 zero bytes ‖ 16-byte big-endian two's-complement |
//! | PI₃   | nullifier   | `BytesN<32>` passed directly                     | raw 32 bytes as-is                            |
//!
//! The **public-input commitment** stored in the proof header equals:
//!
//! ```text
//! PI_hash = SHA-256( PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃ )
//! ```
//!
//! All hashing uses `env.crypto().sha256()` — the host-accelerated primitive.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::types::PUBLIC_INPUT_BYTES;

/// Reconstruct the canonical 128-byte public-input vector and return it along
/// with its 32-byte SHA-256 commitment hash.
///
/// # Arguments
/// * `env`        – Soroban execution environment (for host crypto).
/// * `commitment` – 32-byte policy-hash committed when funds were locked.
/// * `payee`      – Soroban `Address` of the intended payment recipient.
/// * `amount`     – Payment amount in stroops (`i128`; caller must ensure > 0).
/// * `nullifier`  – 32-byte replay-prevention ticket.
///
/// # Returns
/// `(pi_bytes, pi_hash)` where:
/// * `pi_bytes` – 128-byte canonical public-input vector.
/// * `pi_hash`  – 32-byte `SHA-256(pi_bytes)`, which must equal the
///   commitment embedded in a valid proof.
///
/// # Determinism
/// This function is pure: it reads no storage and has no side effects. Given
/// identical inputs it always produces identical outputs.
pub fn build_public_inputs(
    env: &Env,
    commitment: &BytesN<32>,
    payee: &Address,
    amount: i128,
    nullifier: &BytesN<32>,
) -> (Bytes, BytesN<32>) {
    // ── PI₀ : commitment (32 bytes, raw) ─────────────────────────────────────
    let pi0: [u8; 32] = commitment.to_array();

    // ── PI₁ : payee hash (32 bytes) ──────────────────────────────────────────
    // Serialise the Address to its canonical Soroban byte representation using
    // `Address::to_xdr`, then SHA-256-hash it into a 32-byte field element.
    // The prover (#67) MUST use the same XDR serialisation; this is specified
    // in #66 §3.2.
    let payee_xdr: Bytes = payee.to_xdr(env);
    let payee_hash_bn: BytesN<32> = env.crypto().sha256(&payee_xdr).into();
    let pi1: [u8; 32] = payee_hash_bn.to_array();

    // ── PI₂ : amount scalar (32 bytes, big-endian) ────────────────────────────
    // `amount` is an i128 stored in stroops. The circuit treats it as an
    // unsigned 128-bit big-endian integer (amounts are always positive).
    // Encoding: 16 zero bytes (high word) ‖ 16-byte big-endian representation.
    // This matches the Noir `Field` injection used in circuit #65.
    let amount_u128 = amount as u128;
    let amount_be = amount_u128.to_be_bytes(); // [u8; 16]
    let mut pi2 = [0u8; 32];
    // pi2[0..16] stays zero (high 128 bits)
    pi2[16..32].copy_from_slice(&amount_be);

    // ── PI₃ : nullifier (32 bytes, raw) ──────────────────────────────────────
    let pi3: [u8; 32] = nullifier.to_array();

    // ── Assemble into a 128-byte Soroban `Bytes` ─────────────────────────────
    let mut raw = [0u8; PUBLIC_INPUT_BYTES]; // 4 × 32 = 128
    raw[0..32].copy_from_slice(&pi0);
    raw[32..64].copy_from_slice(&pi1);
    raw[64..96].copy_from_slice(&pi2);
    raw[96..128].copy_from_slice(&pi3);

    let pi_bytes = Bytes::from_slice(env, &raw);

    // ── Compute PI_hash = SHA-256(PI₀ ‖ PI₁ ‖ PI₂ ‖ PI₃) ───────────────────
    let pi_hash: BytesN<32> = env.crypto().sha256(&pi_bytes).into();

    (pi_bytes, pi_hash)
}

#[cfg(test)]
mod encoding_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_encoding_deterministic() {
        let env = Env::default();
        let commitment: BytesN<32> = BytesN::from_array(&env, &[0x01u8; 32]);
        let payee = Address::generate(&env);
        let nullifier: BytesN<32> = BytesN::from_array(&env, &[0x03u8; 32]);
        let amount: i128 = 1_000_000;

        let (pi1, hash1) = build_public_inputs(&env, &commitment, &payee, amount, &nullifier);
        let (pi2, hash2) = build_public_inputs(&env, &commitment, &payee, amount, &nullifier);

        assert_eq!(pi1, pi2, "public-input bytes must be deterministic");
        assert_eq!(hash1, hash2, "public-input hash must be deterministic");
    }

    #[test]
    fn test_encoding_amount_layout() {
        let env = Env::default();
        let commitment: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        let payee = Address::generate(&env);
        let nullifier: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        // amount = 1 → big-endian u128 → 0x00..0001 (16 bytes)
        // PI₂ = 16 zero bytes ‖ 0x00000000000000000000000000000001
        let (pi_bytes, _) = build_public_inputs(&env, &commitment, &payee, 1, &nullifier);
        let mut raw = [0u8; 128];
        for i in 0..128u32 {
            raw[i as usize] = pi_bytes.get(i).unwrap_or(0);
        }
        // bytes [64..79] must all be zero (high word)
        for b in &raw[64..80] {
            assert_eq!(*b, 0);
        }
        // PI2 is bytes [64..96); the last byte of amount scalar must be 1
        assert_eq!(raw[95], 1);
    }

    #[test]
    fn test_different_payees_produce_different_hashes() {
        let env = Env::default();
        let commitment: BytesN<32> = BytesN::from_array(&env, &[0xAAu8; 32]);
        let payee_a = Address::generate(&env);
        let payee_b = Address::generate(&env);
        let nullifier: BytesN<32> = BytesN::from_array(&env, &[0xBBu8; 32]);

        let (_, hash_a) = build_public_inputs(&env, &commitment, &payee_a, 500, &nullifier);
        let (_, hash_b) = build_public_inputs(&env, &commitment, &payee_b, 500, &nullifier);

        assert_ne!(
            hash_a, hash_b,
            "different payees must yield different hashes"
        );
    }

    #[test]
    fn test_different_amounts_produce_different_hashes() {
        let env = Env::default();
        let commitment: BytesN<32> = BytesN::from_array(&env, &[0x10u8; 32]);
        let payee = Address::generate(&env);
        let nullifier: BytesN<32> = BytesN::from_array(&env, &[0x20u8; 32]);

        let (_, h1) = build_public_inputs(&env, &commitment, &payee, 100, &nullifier);
        let (_, h2) = build_public_inputs(&env, &commitment, &payee, 101, &nullifier);

        assert_ne!(h1, h2, "different amounts must yield different hashes");
    }
}
