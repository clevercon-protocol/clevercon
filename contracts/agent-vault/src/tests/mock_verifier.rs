//! A configurable mock of the external policy-verifier contract (issue #64),
//! used only in tests.
//!
//! It implements the single entry point `AgentVault` calls on a verifier —
//! `verify_policy(commitment, payee, amount, nullifier, proof) -> bool` — plus
//! test helpers to control its verdict and to observe whether it was called.
//!
//! Modes:
//! - `AcceptAll`  — return `true` for any input.
//! - `RejectAll`  — return `false` for any input (a well-behaved verifier
//!   rejecting a bad proof).
//! - `ExpectBinding` — return `true` only if `(payee, amount)` match the values
//!   configured via `set_expected`; models a verifier that rejects a proof
//!   generated for a different payee or amount than the one presented.
//! - `Trap` — panic, modelling a broken or hostile verifier. `AgentVault` must
//!   still fail closed (no funds move, no nullifier burned).
//!
//! `calls()` returns how many times `verify_policy` has been invoked, so a test
//! can assert the verifier was never contacted (e.g. when the budget check
//! rejects a release before verification).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env,
};

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MockVerifierError {
    /// Raised in `Trap` mode to model a verifier that aborts instead of
    /// returning a verdict. `AgentVault` must still fail closed.
    Trapped = 1,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum VerifyMode {
    AcceptAll,
    RejectAll,
    ExpectBinding,
    Trap,
}

#[derive(Clone)]
#[contracttype]
pub struct ExpectedBinding {
    pub payee: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Mode,
    Expected,
    Calls,
}

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    /// Set the verdict mode. Also resets the call counter.
    pub fn configure(env: Env, mode: VerifyMode) {
        env.storage().instance().set(&DataKey::Mode, &mode);
        env.storage().instance().set(&DataKey::Calls, &0u32);
    }

    /// Configure the `(payee, amount)` pair that `ExpectBinding` mode accepts.
    pub fn set_expected(env: Env, payee: Address, amount: i128) {
        env.storage()
            .instance()
            .set(&DataKey::Expected, &ExpectedBinding { payee, amount });
    }

    /// Number of times `verify_policy` has been invoked since the last
    /// `configure`.
    pub fn calls(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Calls).unwrap_or(0)
    }

    /// The verifier entry point `AgentVault::release_payment_proved` calls.
    /// Records the invocation, then returns a verdict per the configured mode.
    pub fn verify_policy(
        env: Env,
        _commitment: BytesN<32>,
        payee: Address,
        amount: i128,
        _nullifier: BytesN<32>,
        _proof: Bytes,
    ) -> bool {
        let calls: u32 = env.storage().instance().get(&DataKey::Calls).unwrap_or(0);
        env.storage().instance().set(&DataKey::Calls, &(calls + 1));

        let mode: VerifyMode = env
            .storage()
            .instance()
            .get(&DataKey::Mode)
            .unwrap_or(VerifyMode::RejectAll);

        match mode {
            VerifyMode::AcceptAll => true,
            VerifyMode::RejectAll => false,
            VerifyMode::Trap => panic_with_error!(&env, MockVerifierError::Trapped),
            VerifyMode::ExpectBinding => {
                let expected: ExpectedBinding = env
                    .storage()
                    .instance()
                    .get(&DataKey::Expected)
                    .expect("ExpectBinding mode requires set_expected first");
                expected.payee == payee && expected.amount == amount
            }
        }
    }
}
