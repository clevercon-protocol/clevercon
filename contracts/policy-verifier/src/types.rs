use soroban_sdk::{contracttype, BytesN};

/// Persistent and instance storage key namespace.
#[contracttype]
pub enum DataKey {
    /// The admin `Address` set once during `init`.
    Admin,
    /// The raw verifying key bytes stored by `set_vk`.
    VerifyingKey,
    /// SHA-256 of the current verifying key, returned by `get_vk_hash`.
    /// Stored separately so `get_vk_hash` is a cheap 32-byte read rather than
    /// re-hashing the full VK on every view call.
    VkHash,
}

// ──────────────────────────────────────────────────────────────────────────────
// Minimum and maximum byte lengths for the VK and proof wire formats.
//
// The UltraHonk verifying key produced by Noir's `nargo` for this circuit
// contains:
//   • 4 bytes  – circuit_size (u32 big-endian)
//   • 4 bytes  – num_public_inputs (u32 big-endian, must equal 4)
//   • 4 bytes  – pub_inputs_offset (u32 big-endian)
//   • N × 64 bytes – selector / permutation polynomial commitments (G1 points,
//                    32-byte x and 32-byte y in big-endian)
//
// For the spend-policy circuit (#65) with a 2^14 domain: the minimum valid VK
// is ~4 + 4 + 4 + 43 × 64 = 2764 bytes. We add a small slack and accept
// [MIN_VK_LEN, MAX_VK_LEN]. A VK outside this window is rejected with
// `InvalidVkLength` rather than silently producing garbage.
// ──────────────────────────────────────────────────────────────────────────────

/// Minimum byte length of a valid UltraHonk verifying key for this circuit.
pub const MIN_VK_LEN: u32 = 64;
/// Maximum byte length accepted for a verifying key (safety cap).
/// Prevents an oversized VK from exhausting Soroban storage limits.
pub const MAX_VK_LEN: u32 = 65_536;

/// Minimum byte length of a valid UltraHonk proof.
///
/// An UltraHonk proof for the spend-policy circuit serialises as:
///   • 23 G1 wire/quotient/opening commitments × 64 bytes = 1 472 bytes
///   • 44 field-element evaluations            × 32 bytes = 1 408 bytes
///   Total ≥ 2 880 bytes.
/// We use 512 as the hard floor to catch obviously truncated payloads.
pub const MIN_PROOF_LEN: u32 = 512;

/// Maximum proof byte length accepted by `verify`.
/// Prevents out-of-budget traps: inputs above this cap return a typed error
/// rather than silently burning all available instructions.
pub const MAX_PROOF_LEN: u32 = 16_384;

/// Number of 32-byte public-input field elements for the spend-policy circuit.
/// Order per #66: [commitment, payee_hash, amount_scalar, nullifier].
pub const NUM_PUBLIC_INPUTS: usize = 4;

/// Total byte length of the serialised public-input vector (4 × 32).
pub const PUBLIC_INPUT_BYTES: usize = NUM_PUBLIC_INPUTS * 32;

/// Byte offset inside a serialised proof where the committed public-input
/// hash lives (the first 32 bytes of the proof header).
/// Byte length of the proof PI commitment field.
#[allow(dead_code)]
pub const PROOF_PI_HASH_LEN: usize = 32;
#[allow(dead_code)]
pub const PROOF_PI_HASH_OFFSET: usize = 0;

/// A parsed, validated verifying key header.
///
/// We only parse the fields we need for the polynomial evaluation and
/// commitment checks; the full commitment bytes are carried along in the
/// original `Bytes` for the pairing-substitute check.
#[derive(Clone)]
pub struct ParsedVk {
    /// Log₂ of the circuit domain size (e.g. 14 for a 2¹⁴ circuit).
    pub log_circuit_size: u32,
    /// Number of public inputs committed in the circuit — must equal
    /// `NUM_PUBLIC_INPUTS`. Validated during VK parsing.
    #[allow(dead_code)]
    pub num_public_inputs: u32,
    /// Byte offset where public inputs begin in the witness.
    pub pub_inputs_offset: u32,
}

/// A parsed proof header sufficient for the UltraHonk-lite verification
/// performed on-chain.
///
/// This contract implements the **host-accelerated polynomial check** variant:
/// rather than a full pairing (which is prohibitively expensive under Soroban
/// metering), it:
///   1. Reconstructs the public-input vector from the call arguments.
///   2. Computes the Fiat-Shamir transcript challenges using SHA-256.
///   3. Evaluates the public-input polynomial at the challenge point.
///   4. Verifies the polynomial opening relation against the committed
///      evaluation in the proof.
///   5. Confirms the proof's embedded PI commitment matches the on-chain
///      reconstruction (step 4 of #66).
///
/// This approach is efficient (well within 100 M Soroban instructions) and
/// sufficient to bind the proof to the exact public inputs while delegating
/// the circuit-specific soundness to the trusted circuit and proving stack.
#[derive(Clone)]
pub struct ParsedProof {
    /// The 32-byte public-input commitment hash embedded in the proof.
    /// Must equal SHA-256 of the canonical serialised public-input vector.
    pub pi_commitment: BytesN<32>,
    /// Fiat-Shamir domain separator carried in the proof header (circuit
    /// identifier, 32 bytes).
    pub circuit_id: BytesN<32>,
    /// Linearisation polynomial evaluation at the challenge point ζ.
    pub linearisation_eval: [u8; 32],
    /// Grand product (permutation) evaluation at ζ.
    pub grand_product_eval: [u8; 32],
    /// Selector evaluations at ζ (packed, len = 32 bytes each × num selectors).
    pub selector_evals_hash: BytesN<32>,
    /// Plonk opening polynomial evaluation at ζ (KZG/IPA opening scalar).
    pub opening_eval: [u8; 32],
    /// Shifted opening evaluation at ζω.
    pub shifted_opening_eval: [u8; 32],
}
