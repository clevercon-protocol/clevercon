use soroban_sdk::contracterror;

/// All typed errors the policy-verifier contract can return.
///
/// Every error maps to an unambiguous failure mode, so callers (CleverVault)
/// can distinguish a cryptographic failure from a configuration error or a
/// malformed input, rather than receiving a panic that looks like success.
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum VerifierError {
    /// `init` was already called; the contract is immutably initialised.
    AlreadyInitialized = 1,
    /// A function requiring the admin to be set was called before `init`.
    NotInitialized = 2,
    /// The caller is not the stored admin.
    Unauthorized = 3,
    /// `verify` was called while no verifying key has been stored yet.
    /// Fail-closed: always treated as invalid proof.
    VkNotSet = 4,
    /// The verifying key bytes supplied to `set_vk` have an illegal length.
    InvalidVkLength = 5,
    /// The proof `Bytes` supplied to `verify` have an illegal length.
    InvalidProofLength = 6,
    /// The `amount` argument is ≤ 0, which is never a valid payment.
    InvalidAmount = 7,
    /// The proof bytes could not be parsed into a well-formed proof structure.
    MalformedProof = 8,
    /// The stored verifying key could not be parsed into a valid VK structure.
    MalformedVk = 9,
    /// The public inputs reconstructed on-chain do not match those committed
    /// inside the proof (inner π₀ check failed).
    PublicInputMismatch = 10,
    /// Cryptographic verification failed (polynomial or opening check).
    VerificationFailed = 11,
}
