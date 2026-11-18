//! A minimal, deliberately malicious SAC-shaped token used only in tests.
//!
//! Implements just the two entry points `AgentVault` actually calls on a
//! token (`transfer`, `balance`) plus `mint`/`configure` helpers. Its
//! `transfer` performs the real balance move first (so the outer call's
//! accounting reflects a genuine transfer, exactly like a token with a
//! post-transfer hook — e.g. an ERC-777-style callback) and then, if armed
//! via `configure`, re-enters the vault with an attacker-chosen call before
//! returning control to the vault. This is the shape of attack the
//! checks-effects-interactions ordering in `AgentVault` must be safe against.

use crate::AgentVaultClient;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum ReentryAction {
    None,
    Withdraw,
    ReleasePayment,
}

#[derive(Clone)]
#[contracttype]
pub struct ReentryConfig {
    pub vault: Address,
    pub action: ReentryAction,
    // withdraw(user, asset, amount)
    pub withdraw_user: Address,
    pub withdraw_asset: Address,
    pub withdraw_amount: i128,
    // release_payment(orchestrator, task_id, step_id, asset, amount)
    pub release_orchestrator: Address,
    pub release_task_id: u64,
    pub release_step_id: u64,
    pub release_asset: Address,
    pub release_amount: i128,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Balance(Address),
    Config,
    ReentryAttempted,
    ReentryOk,
}

#[contract]
pub struct MaliciousToken;

#[contractimpl]
impl MaliciousToken {
    /// Arm (or disarm with `ReentryAction::None`) the reentry hook.
    pub fn configure(env: Env, config: ReentryConfig) {
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().remove(&DataKey::ReentryAttempted);
        env.storage().instance().remove(&DataKey::ReentryOk);
    }

    /// Whether the last `transfer` actually attempted a reentrant call.
    pub fn reentry_attempted(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::ReentryAttempted)
            .unwrap_or(false)
    }

    /// Whether the reentrant call the last `transfer` attempted returned Ok.
    pub fn reentry_succeeded(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::ReentryOk)
            .unwrap_or(false)
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = DataKey::Balance(to);
        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    /// The dangerous part: mutates real balances first (so the caller's own
    /// bookkeeping sees a genuine transfer), then — if armed — calls back
    /// into the vault BEFORE returning, simulating a token transfer hook.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = DataKey::Balance(from.clone());
        let to_key = DataKey::Balance(to.clone());
        let from_balance: i128 = env.storage().instance().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let to_balance: i128 = env.storage().instance().get(&to_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .instance()
            .set(&to_key, &(to_balance + amount));

        if let Some(config) = env
            .storage()
            .instance()
            .get::<_, ReentryConfig>(&DataKey::Config)
        {
            if config.action != ReentryAction::None {
                env.storage()
                    .instance()
                    .set(&DataKey::ReentryAttempted, &true);
                // Disarm BEFORE re-entering so any transfer triggered by the
                // reentrant call itself (e.g. withdraw's own payout) does not
                // cascade into further, unbounded reentrancy. This keeps each
                // test's attack a clean, single-level reentry.
                let mut disarmed = config.clone();
                disarmed.action = ReentryAction::None;
                env.storage().instance().set(&DataKey::Config, &disarmed);

                let vault_client = AgentVaultClient::new(&env, &config.vault);
                let ok = match config.action {
                    ReentryAction::Withdraw => {
                        let res = vault_client.try_withdraw(
                            &config.withdraw_user,
                            &config.withdraw_asset,
                            &config.withdraw_amount,
                        );
                        matches!(res, Ok(Ok(())))
                    }
                    ReentryAction::ReleasePayment => {
                        let res = vault_client.try_release_payment(
                            &config.release_orchestrator,
                            &config.release_task_id,
                            &config.release_step_id,
                            &config.release_asset,
                            &config.release_amount,
                        );
                        matches!(res, Ok(Ok(true)))
                    }
                    ReentryAction::None => false,
                };
                env.storage().instance().set(&DataKey::ReentryOk, &ok);
            }
        }
    }
}
