#![no_std]
// `release_payment_proved` keeps `release_payment`'s flat parameter style
// (issue #122's proposed public surface) and adds `payee`, `nullifier`, and
// `proof` to the existing five parameters. That exceeds Clippy's default
// arg-count threshold in the wrapper/spec code the `#[contractimpl]` macro
// generates, where a function- or impl-scoped `#[allow]` does not reach. This
// is the only signature in the crate over the threshold.
#![allow(clippy::too_many_arguments)]
//! AgentVault — Soroban smart contract (v2)
//!
//! Trustless treasury for AgentForge. Holds multiple whitelisted assets (USDC, XLM, etc.)
//! for users, manages per-user, per-asset balances, registers personal orchestrators,
//! and releases per-step payments to orchestrators in the requested asset during task execution.
//!
//! ### Multi-Asset Storage Layout Design
//! In this multi-asset version, storage keys and structs are structured as follows:
//! 1. `DataKey::UserAsset(User, Asset)`: Maps a user address and a specific token's SAC address
//!    to `UserAssetAccount` which tracks asset-specific balances: balance, locked, total_deposited,
//!    total_spent, and created_at.
//! 2. `DataKey::UserConfig(User)`: Maps a user address to user-wide settings (`UserConfig`):
//!    orchestrator, orchestrator_name, and active_tasks_count.
//! 3. `DataKey::Task(task_id)`: Maps a task_id to `TaskInfo` which now includes the `asset: Address` field.
//! 4. `DataKey::AssetSupported(Asset)`: Maps an asset SAC address to `true`, indicating it is a supported whitelisted asset.
//! 5. `DataKey::SupportedAssets`: An enumerable `Vec<Address>` of every whitelisted asset, kept in sync with the
//!    per-asset `AssetSupported` flags so `get_supported_assets` and `is_supported_asset` never disagree.

use soroban_sdk::contracterror;
use soroban_sdk::{
    contract, contractclient, contractevent, contractimpl, contracttype, log, token, Address,
    Bytes, BytesN, Env, String, Vec,
};

/// Interface of the external, privacy-preserving policy verifier contract
/// (tracked as issue #64). [`AgentVault::release_payment_proved`] calls
/// [`PolicyVerifier::verify_policy`] with the task's committed policy hash plus
/// the release's public parameters. A `true` return is the **only** signal that
/// authorizes the release; any other outcome — a `false`, a contract error, or
/// a trap — is treated as a rejection and moves no funds.
///
/// Public-input ordering is fixed here as `(commitment, payee, amount,
/// nullifier)` in the absence of issue #66's authoritative specification. The
/// real verifier and that document must agree with this order, or this call
/// site changes.
#[contractclient(name = "PolicyVerifierClient")]
pub trait PolicyVerifier {
    fn verify_policy(
        env: Env,
        commitment: BytesN<32>,
        payee: Address,
        amount: i128,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) -> bool;
}

// Events

#[contractevent]
pub struct DepositEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
}

#[contractevent]
pub struct WithdrawEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
}

#[contractevent]
pub struct RegOrchEvent {
    #[topic]
    pub user: Address,
    pub orchestrator: Address,
}

#[contractevent]
pub struct UpdateOrchEvent {
    #[topic]
    pub user: Address,
    pub old_orchestrator: Address,
    pub new_orchestrator: Address,
}

#[contractevent]
pub struct TaskNewEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub orchestrator: Address,
    #[topic]
    pub task_id: u64,
    pub asset: Address,
    pub plan_cost: i128,
}

#[contractevent]
pub struct ReleaseEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub orchestrator: Address,
    #[topic]
    pub task_id: u64,
    pub asset: Address,
    pub amount: i128,
}

#[contractevent]
pub struct TaskDoneEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub task_id: u64,
    pub asset: Address,
    pub spent: i128,
    pub refund: i128,
}

#[contractevent]
pub struct PauseEvent {
    #[topic]
    pub admin: Address,
}

#[contractevent]
pub struct UnpauseEvent {
    #[topic]
    pub admin: Address,
}
#[contractevent]
pub struct UpdateAdminEvent {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
}

#[contractevent]
pub struct DisputeRaisedEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub task_id: u64,
}

#[contractevent]
pub struct DisputeResolvedEvent {
    #[topic]
    pub resolver: Address,
    #[topic]
    pub task_id: u64,
    pub refund_to_user: i128,
    pub payout_to_orchestrator: i128,
}

#[contractevent]
pub struct FeeSetEvent {
    #[topic]
    pub admin: Address,
    pub bps: u32,
    pub recipient: Option<Address>,
}

#[contractevent]
pub struct FeeAccruedEvent {
    #[topic]
    pub asset: Address,
    #[topic]
    pub recipient: Address,
    pub fee_amount: i128,
    pub task_id: u64,
}

#[contractevent]
pub struct FeeClaimedEvent {
    #[topic]
    pub asset: Address,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

/// Emitted whenever the admin sets or changes the policy-verifier contract.
/// `old` is `None` on the first set. Present so any swap of the verifier —
/// which the admin can do at any time — is publicly observable on-chain.
#[contractevent]
pub struct PolicyVerifierSetEvent {
    #[topic]
    pub admin: Address,
    pub old: Option<Address>,
    pub new: Address,
}

/// Emitted by `create_task_with_policy` after the task is created and its
/// private spending-policy commitment recorded. The commitment is an opaque
/// hash; it reveals nothing about the policy itself.
#[contractevent]
pub struct PolicyCommittedEvent {
    #[topic]
    pub task_id: u64,
    pub commitment: BytesN<32>,
}

/// Emitted by `release_payment_proved` on a successful proof-gated release.
/// Mirrors [`ReleaseEvent`] plus the spent `nullifier`, so indexers can track
/// replay protection. The zero-knowledge proof bytes are deliberately **never**
/// included here or written to any log.
#[contractevent]
pub struct ReleaseProvedEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub orchestrator: Address,
    #[topic]
    pub task_id: u64,
    pub asset: Address,
    pub amount: i128,
    pub nullifier: BytesN<32>,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    ContractPaused = 3,
    AssetNotSupported = 4,
    InsufficientBalance = 5,
    InsufficientAvailable = 6,
    ActiveTaskExists = 7,
    TaskNotFound = 8,
    TaskAlreadyCompleted = 9,
    TaskNotStale = 10,
    InvalidAmount = 11,
    ExceedsPlanCost = 12,
    AssetMismatch = 13,
    OrchestratorNotRegistered = 14,
    OrchestratorAlreadyRegistered = 15,
    NotYourTask = 16,
    NotYourOrchestrator = 17,
    TooManyActiveTasks = 18,
    TaskDisputed = 19,
    NotDisputeResolver = 20,
    DisputeSplitMismatch = 21,
    DisputeResolverNotSet = 22,
    TaskNotDisputed = 23,
    ReleaseConflict = 24,
    TooManyStepReleases = 25,
    FeeBpsExceedsCap = 26,
    NoFeesAccrued = 27,
    /// `create_task_with_policy` was given an all-zero commitment, which no
    /// real proof could ever satisfy.
    InvalidCommitment = 28,
    /// `release_payment_proved` was called but no policy verifier is
    /// configured. Fail closed — no verifier call is attempted, no funds move.
    PolicyVerifierNotSet = 29,
    /// Plain `release_payment` was called on a task that carries a policy
    /// commitment. Such tasks can only be released via `release_payment_proved`.
    PolicyProofRequired = 30,
    /// `release_payment_proved` was called on a task with no policy commitment.
    /// Such tasks can only be released via plain `release_payment`.
    NoPolicyCommitment = 31,
    /// The policy verifier did not return an explicit `true` for the supplied
    /// proof and public inputs. Funds do not move and the nullifier is NOT
    /// marked spent.
    PolicyProofRejected = 32,
    /// This nullifier has already been consumed for this task. Rejected as a
    /// replay before the verifier is contacted.
    NullifierAlreadyUsed = 33,
}

// Storage keys

/// Storage keys for all persistent and instance data in this contract.
#[contracttype]
pub enum DataKey {
    /// Admin address, set once during `init`.
    Admin,
    /// USDC Stellar Asset Contract address, set once during `init`.
    UsdcSac,
    /// Maps a user address and an asset address to their [`UserAssetAccount`].
    UserAsset(Address, Address),
    /// Maps a user address to their global user-wide [`UserConfig`].
    UserConfig(Address),
    /// Maps a task_id to its [`TaskInfo`].
    Task(u64),
    /// Monotonically increasing counter used to allocate new task_ids.
    TaskCounter,
    /// Reverse lookup: maps an orchestrator address to the user address that registered it.
    OrchestratorOwner(Address),
    /// Maps an asset address to a boolean indicating support status.
    AssetSupported(Address),
    /// Enumerable index of all whitelisted asset addresses, kept in sync with
    /// the per-asset [`DataKey::AssetSupported`] flags.
    SupportedAssets,
    /// Returns true if the contract is paused.
    Paused,
    UserTasks(Address),
    /// Configurable threshold for force-completing stale tasks.
    StaleTaskThreshold,
    /// Configurable cap on how many active tasks a single user may hold at once.
    MaxActiveTasks,
    /// The dedicated resolver authorized to settle raised disputes.
    DisputeResolver,
    /// Idempotency record for a released plan step under a task.
    TaskStepRelease(u64, u64),
    /// Enumerable list of released step IDs for cleanup on task finalization.
    TaskStepIds(u64),
    /// Protocol fee configuration: basis points and recipient address.
    FeeConfig,
    /// Per-asset accrued (but unclaimed) protocol fees: asset → i128.
    AccruedFees(Address),
    /// The external policy-verifier contract address. Admin-set, mutable at any
    /// time (mirrors [`DataKey::DisputeResolver`]). Absent means the proof-gated
    /// release path is disabled and fails closed.
    PolicyVerifier,
    /// Per-task consumed-nullifier marker: `(task_id, nullifier) → ()`. Presence
    /// means this nullifier has already produced a proof-gated release for this
    /// task and may not be reused. Scoped per task (not global) so the entries
    /// share the task's TTL lifecycle and are pruned on finalization; the
    /// per-task commitment already prevents cross-task proof reuse.
    TaskNullifier(u64, BytesN<32>),
    /// Enumerable index of a task's consumed nullifiers, for unit TTL refresh
    /// and cleanup on finalization. Mirrors [`DataKey::TaskStepIds`].
    TaskNullifierIds(u64),
}

// Data structs

/// Asset-specific balances and history for a user.
#[contracttype]
#[derive(Clone)]
pub struct UserAssetAccount {
    /// Total balance held (available + locked), in stroops.
    pub balance: i128,
    /// Portion of `balance` reserved for active tasks in this asset.
    pub locked: i128,
    /// Lifetime deposits, for analytics.
    pub total_deposited: i128,
    /// Lifetime task spending, for analytics.
    pub total_spent: i128,
    /// Ledger timestamp when this asset account was first created.
    pub created_at: u64,
}

/// Global, asset-agnostic user settings.
#[contracttype]
#[derive(Clone)]
pub struct UserConfig {
    /// The orchestrator registered for this user, if any.
    pub orchestrator: Option<Address>,
    /// Human-readable name of the registered orchestrator.
    pub orchestrator_name: String,
    /// Number of active tasks. Must be 0 to create a new task or withdraw.
    pub active_tasks_count: u32,
    /// Ledger timestamp when this configuration was first created.
    pub created_at: u64,
}

/// Consolidated user account structure for external view queries.
#[contracttype]
#[derive(Clone)]
pub struct UserAccount {
    /// Total balance held (available + locked), in stroops.
    pub balance: i128,
    /// Portion of `balance` reserved for active tasks.
    pub locked: i128,
    /// Lifetime deposits.
    pub total_deposited: i128,
    /// Lifetime task spending.
    pub total_spent: i128,
    /// Number of active tasks.
    pub active_tasks_count: u32,
    /// The orchestrator registered for this user, if any.
    pub orchestrator: Option<Address>,
    /// Human-readable name of the registered orchestrator.
    pub orchestrator_name: String,
    /// Ledger timestamp when this account record was created.
    pub created_at: u64,
}

/// Per-task state, written by create_task and updated by release_payment/complete_task.
#[contracttype]
#[derive(Clone)]
pub struct TaskInfo {
    /// The user who owns this task and whose balance is locked.
    pub user: Address,
    /// The orchestrator authorized to release payments for this task.
    pub orchestrator: Address,
    /// The asset SAC address used for this task.
    pub asset: Address,
    /// Total budget locked for this task, in stroops.
    pub plan_cost: i128,
    /// Amount released to the orchestrator so far, in stroops.
    pub spent: i128,
    /// Whether this task has been finalized (completed, cancelled, or force-completed).
    pub completed: bool,
    /// Whether the user has raised a dispute that freezes this task pending
    /// resolution by the configured `dispute_resolver`. A resolved dispute
    /// leaves this flag set as an audit record; the task is then `completed`.
    pub disputed: bool,
    /// Private spending-policy commitment, set only by
    /// [`AgentVault::create_task_with_policy`]. `Some` routes every release for
    /// this task through the proof-gated [`AgentVault::release_payment_proved`]
    /// path; `None` (the plain [`AgentVault::create_task`] path) routes it
    /// through [`AgentVault::release_payment`]. This single field on the single
    /// task record is the sole discriminator between the two paths — one value,
    /// one TTL lifecycle, so the two paths can never both (or neither) apply.
    pub policy_commitment: Option<BytesN<32>>,
    /// Ledger timestamp when this task was created.
    pub created_at: u64,
}

/// Per-step release idempotency record. Presence means this `(task_id, step_id)`
/// has already produced its transfer with the recorded amount.
#[contracttype]
#[derive(Clone)]
pub struct StepRelease {
    pub amount: i128,
}

/// Authoritative lifecycle state for a task at the current ledger timestamp.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskStatus {
    Active,
    Stale,
    Disputed,
    Completed,
}

/// Protocol fee configuration stored in instance storage.
///
/// `bps` is the fee in basis points (1 bps = 0.01%). The hard cap is 1000
/// (10%). A zero `bps` or absent `recipient` disables fee collection and
/// behaves identically to the no-fee path, so the zero-fee invariant is
/// regression-safe.
#[contracttype]
#[derive(Clone)]
pub struct FeeConfig {
    /// Fee in basis points. Must be <= `MAX_FEE_BPS`. Zero disables fees.
    pub bps: u32,
    /// Address that accrues and can claim the collected fees.
    /// `None` disables fee collection even if `bps > 0`.
    pub recipient: Option<Address>,
}

// Constants

/// Tasks older than this that haven't completed can be force-finalized by anyone.
const STALE_TASK_THRESHOLD_SECONDS: u64 = 1800; // 30 minutes

/// Hard cap on the configurable protocol fee: 1000 bps = 10%.
const MAX_FEE_BPS: u32 = 1000;

/// Default cap on concurrent active tasks per user. Normal usage — even an
/// orchestrator juggling several in-flight plans for one user — sits well
/// under this; it exists to bound storage growth from a buggy or hostile
/// orchestrator, not to constrain everyday behavior.
const DEFAULT_MAX_ACTIVE_TASKS: u32 = 50;

/// Maximum number of task records returned by `get_user_task_infos`.
const MAX_USER_TASK_INFOS_PAGE_SIZE: u32 = 50;

/// Bounds per-task idempotency storage. Normal plans are far smaller; the cap
/// prevents a hostile orchestrator from creating unbounded persistent keys.
const MAX_RELEASE_STEPS_PER_TASK: u32 = 256;

const PERSISTENT_TTL_THRESHOLD: u32 = 17_280; // ~1 day
const PERSISTENT_TTL_EXTEND_TO: u32 = 518_400; // ~30 days

const INSTANCE_TTL_THRESHOLD: u32 = 17_280; // ~1 day
const INSTANCE_TTL_EXTEND_TO: u32 = 518_400; // ~30 days

/// Compile-time contract version, exposed on-chain via `version()`.
///
/// MUST be bumped whenever the public interface or storage layout
/// changes -- operators and clients rely on this to confirm a
/// deployment before assuming a given function or storage layout
/// exists, especially important on Soroban where the same address
/// can be upgraded in place.
const CONTRACT_VERSION: u32 = 6;

// Contract

/// The CleverVault contract — a trustless treasury that holds multiple whitelisted
/// assets on behalf of users and releases per-step payments to their registered orchestrators.
#[contract]
pub struct AgentVault;

#[contractimpl]
impl AgentVault {
    // Initialisation

    /// One-time init — sets admin and USDC SAC address, and automatically whitelists USDC.
    pub fn init(env: Env, admin: Address, usdc_sac: Address) -> Result<(), VaultError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VaultError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcSac, &usdc_sac);
        env.storage().instance().set(&DataKey::TaskCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::StaleTaskThreshold, &STALE_TASK_THRESHOLD_SECONDS);

        // Automatically whitelist usdc_sac
        let asset_key = DataKey::AssetSupported(usdc_sac.clone());
        env.storage().persistent().set(&asset_key, &true);
        Self::index_add_asset(&env, &usdc_sac);
        // Put the index and the seeded flag on one TTL lifecycle from the start.
        Self::extend_asset_support_ttl(&env);

        Self::extend_instance_ttl(&env);
        log!(
            &env,
            "AgentVault initialized admin={} usdc_sac={}",
            admin,
            usdc_sac
        );
        Ok(())
    }

    // Asset Management

    /// Admin whitelists an accepted asset SAC token.
    pub fn add_asset(env: Env, admin: Address, asset: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        let asset_key = DataKey::AssetSupported(asset.clone());
        env.storage().persistent().set(&asset_key, &true);
        Self::index_add_asset(&env, &asset);
        // Bring the whole support set onto one TTL lifecycle, including the flag
        // just written and every previously-whitelisted asset.
        Self::extend_asset_support_ttl(&env);

        log!(&env, "Asset added to whitelist: {}", asset);
        Ok(())
    }

    /// Admin removes an asset from the whitelist.
    pub fn remove_asset(
        env: Env,
        admin: Address,
        asset: Address,
        force: bool,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        assert!(force, "Pass force=true to confirm removal of a live asset");

        let asset_key = DataKey::AssetSupported(asset.clone());
        if env.storage().persistent().has(&asset_key) {
            env.storage().persistent().remove(&asset_key);
        }
        Self::index_remove_asset(&env, &asset);
        // Keep the remaining support set on one TTL lifecycle after removal.
        Self::extend_asset_support_ttl(&env);

        log!(&env, "Asset removed from whitelist: {}", asset);
        Ok(())
    }

    /// Public view function to check if an asset is supported.
    pub fn is_supported_asset(env: Env, asset: Address) -> bool {
        let asset_key = DataKey::AssetSupported(asset);
        let result = env.storage().persistent().has(&asset_key);
        if result {
            // Refresh the whole support set — index and every flag — so the two
            // representations can never expire out of step. See
            // [`Self::extend_asset_support_ttl`].
            Self::extend_asset_support_ttl(&env);
        }
        result
    }

    /// Enumerates every currently whitelisted asset. Stays consistent with
    /// [`is_supported_asset`]: an address appears here if and only if that
    /// function returns true for it.
    pub fn get_supported_assets(env: Env) -> Vec<Address> {
        let key = DataKey::SupportedAssets;
        let result = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if env.storage().persistent().has(&key) {
            // Refresh the whole support set — index and every flag — so the two
            // representations can never expire out of step. See
            // [`Self::extend_asset_support_ttl`].
            Self::extend_asset_support_ttl(&env);
        }
        result
    }

    // Deposits & Withdrawals

    /// Deposit supported tokens from user's external wallet into their vault balance.
    ///
    /// CEI note: this is a pull (`user` is the token's `from`), so the token
    /// contract runs as part of a transfer the CALLER authorized against
    /// themselves, not against the vault's funds — a re-entrant call made
    /// from inside this transfer sees `asset_account.balance` still at its
    /// PRE-deposit value, which cannot be leveraged for a double-credit.
    /// Audited for CEI; no reordering was needed.
    pub fn deposit(
        env: Env,
        user: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        user.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if !Self::is_supported_asset(env.clone(), asset.clone()) {
            return Err(VaultError::AssetNotSupported);
        }

        Self::extend_instance_ttl(&env);
        let token_client = token::Client::new(&env, &asset);
        // Transfer asset from user → contract. User must have approved this.
        token_client.transfer(&user, env.current_contract_address(), &amount);

        // Ensure user config exists
        let config = Self::get_or_create_config(&env, &user);
        let config_key = DataKey::UserConfig(user.clone());
        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(&env, &config_key);

        let mut asset_account = Self::get_or_create_asset_account(&env, &user, &asset);
        asset_account.balance += amount;
        asset_account.total_deposited += amount;
        let asset_key = DataKey::UserAsset(user.clone(), asset.clone());
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(&env, &asset_key);

        DepositEvent {
            user: user.clone(),
            asset: asset.clone(),
            amount,
        }
        .publish(&env);
        log!(
            &env,
            "deposit user={} asset={} amount={} new_balance={}",
            user,
            asset,
            amount,
            asset_account.balance
        );
        Ok(())
    }

    /// Withdraw tokens from vault back to user's external wallet.
    /// Only the unlocked portion (`balance - locked`) of the given asset may be
    /// withdrawn; funds locked by active tasks for that asset stay reserved, so a
    /// withdrawal succeeds even while other funds — or other assets — are locked.
    ///
    /// CEI ordering: `asset_account.balance` is debited before the external
    /// transfer. See the comment at the transfer call site — do not reorder.
    pub fn withdraw(
        env: Env,
        user: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        user.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let config_key = DataKey::UserConfig(user.clone());
        // Fetched to assert the user has an account on record and to refresh the
        // config TTL. Active tasks no longer block withdrawal — the per-asset
        // `locked` field below is the correct, narrower guard.
        let _config: UserConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("No config found");
        Self::extend_persistent_ttl(&env, &config_key);

        let asset_key = DataKey::UserAsset(user.clone(), asset.clone());
        let mut asset_account: UserAssetAccount = env
            .storage()
            .persistent()
            .get(&asset_key)
            .expect("No asset account");
        Self::extend_persistent_ttl(&env, &asset_key);

        if asset_account.balance < amount {
            return Err(VaultError::InsufficientBalance);
        }
        // Per-asset guard: only the unlocked portion may leave the vault. `locked`
        // tracks exactly how much of THIS asset is committed to active tasks, so a
        // different asset (or the free balance) stays withdrawable while a task
        // runs, while the locked portion does not.
        let available = asset_account.balance - asset_account.locked;
        if amount > available {
            return Err(VaultError::InsufficientAvailable);
        }

        Self::extend_instance_ttl(&env);

        // CEI ordering: all state writes for this withdrawal are committed
        // BEFORE the external token transfer below. A token whose `transfer`
        // re-enters this contract (e.g. via a transfer hook) will observe the
        // already-debited balance, so a second `withdraw` in the same call
        // stack cannot double-spend the same funds. Do not move the transfer
        // above this block.
        asset_account.balance -= amount;
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(&env, &asset_key);

        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        WithdrawEvent {
            user: user.clone(),
            asset: asset.clone(),
            amount,
        }
        .publish(&env);
        log!(
            &env,
            "withdraw user={} asset={} amount={} remaining={}",
            user,
            asset,
            amount,
            asset_account.balance
        );
        Ok(())
    }

    // Orchestrator registration

    /// Register a personal orchestrator for this user. ONE-TIME per user.
    pub fn register_orchestrator(
        env: Env,
        user: Address,
        orchestrator: Address,
        name: String,
    ) -> Result<(), VaultError> {
        user.require_auth();

        let mut config = Self::get_or_create_config(&env, &user);

        if config.orchestrator.is_some() {
            return Err(VaultError::OrchestratorAlreadyRegistered);
        }

        config.orchestrator = Some(orchestrator.clone());
        config.orchestrator_name = name.clone();
        let config_key = DataKey::UserConfig(user.clone());
        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(&env, &config_key);

        // Reverse lookup: orchestrator address → user address
        let owner_key = DataKey::OrchestratorOwner(orchestrator.clone());
        env.storage().persistent().set(&owner_key, &user);
        Self::extend_persistent_ttl(&env, &owner_key);

        RegOrchEvent {
            user: user.clone(),
            orchestrator: orchestrator.clone(),
        }
        .publish(&env);
        log!(
            &env,
            "register_orchestrator user={} orchestrator={}",
            user,
            orchestrator
        );
        Ok(())
    }

    /// Update the registered orchestrator for a user. Requires no active tasks so
    /// in-flight task authorization cannot be stranded on the old orchestrator.
    pub fn update_orchestrator(
        env: Env,
        user: Address,
        new_orchestrator: Address,
        name: String,
    ) -> Result<(), VaultError> {
        user.require_auth();

        let config_key = DataKey::UserConfig(user.clone());
        let mut config: UserConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .ok_or(VaultError::OrchestratorNotRegistered)?;
        Self::extend_persistent_ttl(&env, &config_key);

        if config.active_tasks_count != 0 {
            return Err(VaultError::ActiveTaskExists);
        }

        let old_orchestrator = config
            .orchestrator
            .clone()
            .ok_or(VaultError::OrchestratorNotRegistered)?;

        let new_owner_key = DataKey::OrchestratorOwner(new_orchestrator.clone());
        if let Some(existing_owner) = env.storage().persistent().get::<_, Address>(&new_owner_key) {
            Self::extend_persistent_ttl(&env, &new_owner_key);
            if existing_owner != user {
                return Err(VaultError::OrchestratorAlreadyRegistered);
            }
        }

        let old_owner_key = DataKey::OrchestratorOwner(old_orchestrator.clone());
        env.storage().persistent().remove(&old_owner_key);

        config.orchestrator = Some(new_orchestrator.clone());
        config.orchestrator_name = name;
        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(&env, &config_key);

        env.storage().persistent().set(&new_owner_key, &user);
        Self::extend_persistent_ttl(&env, &new_owner_key);

        UpdateOrchEvent {
            user: user.clone(),
            old_orchestrator: old_orchestrator.clone(),
            new_orchestrator: new_orchestrator.clone(),
        }
        .publish(&env);
        log!(
            &env,
            "update_orchestrator user={} old_orchestrator={} new_orchestrator={}",
            user,
            old_orchestrator,
            new_orchestrator
        );
        Ok(())
    }

    // Task lifecycle

    /// Orchestrator creates a task, locking plan_cost from user's available balance in the specified asset.
    /// Returns the new task_id.
    pub fn create_task(
        env: Env,
        orchestrator: Address,
        asset: Address,
        plan_cost: i128,
    ) -> Result<u64, VaultError> {
        orchestrator.require_auth();
        Self::require_not_paused(&env)?;
        if plan_cost <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if !Self::is_supported_asset(env.clone(), asset.clone()) {
            return Err(VaultError::AssetNotSupported);
        }

        // Resolve orchestrator → user
        let owner_key = DataKey::OrchestratorOwner(orchestrator.clone());
        let user: Address = env
            .storage()
            .persistent()
            .get(&owner_key)
            .ok_or(VaultError::OrchestratorNotRegistered)?;
        Self::extend_persistent_ttl(&env, &owner_key);

        let config_key = DataKey::UserConfig(user.clone());
        let mut config: UserConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("User config not found");
        Self::extend_persistent_ttl(&env, &config_key);

        if config.active_tasks_count >= Self::get_max_active_tasks(env.clone()) {
            return Err(VaultError::TooManyActiveTasks);
        }

        let asset_key = DataKey::UserAsset(user.clone(), asset.clone());
        let mut asset_account: UserAssetAccount = env
            .storage()
            .persistent()
            .get(&asset_key)
            .expect("User asset account not found");
        Self::extend_persistent_ttl(&env, &asset_key);

        let available = asset_account.balance - asset_account.locked;
        if available < plan_cost {
            return Err(VaultError::InsufficientAvailable);
        }

        asset_account.locked += plan_cost;
        config.active_tasks_count += 1;
        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(&env, &config_key);
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(&env, &asset_key);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TaskCounter)
            .unwrap_or(0);
        Self::extend_instance_ttl(&env);
        counter += 1;

        let task = TaskInfo {
            user: user.clone(),
            orchestrator: orchestrator.clone(),
            asset: asset.clone(),
            plan_cost,
            spent: 0,
            completed: false,
            disputed: false,
            // The plain task-creation path never records a commitment. The
            // proof-gated path is reached only via `create_task_with_policy`,
            // which delegates here and then sets this field.
            policy_commitment: None,
            created_at: env.ledger().timestamp(),
        };
        let task_key = DataKey::Task(counter);
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);
        let tasks_key = DataKey::UserTasks(user.clone());
        let mut user_tasks: soroban_sdk::Vec<u64> = env
            .storage()
            .persistent()
            .get(&tasks_key)
            .unwrap_or(soroban_sdk::Vec::new(&env));
        user_tasks.push_back(counter);
        env.storage().persistent().set(&tasks_key, &user_tasks);
        Self::extend_persistent_ttl(&env, &tasks_key);

        env.storage()
            .instance()
            .set(&DataKey::TaskCounter, &counter);
        Self::extend_instance_ttl(&env);

        TaskNewEvent {
            user: user.clone(),
            orchestrator: orchestrator.clone(),
            task_id: counter,
            asset: asset.clone(),
            plan_cost,
        }
        .publish(&env);
        log!(
            &env,
            "create_task id={} orchestrator={} asset={} plan_cost={}",
            counter,
            orchestrator,
            asset,
            plan_cost
        );

        Ok(counter)
    }

    /// Create a task exactly like [`Self::create_task`], but bind a **private
    /// spending-policy commitment** to it. Every release for the resulting task
    /// must go through [`Self::release_payment_proved`] with a proof the
    /// configured verifier accepts; the plain [`Self::release_payment`] path
    /// rejects it with [`VaultError::PolicyProofRequired`].
    ///
    /// `commitment` is an opaque 32-byte hash of the user's off-chain policy —
    /// it reveals nothing on its own. An all-zero commitment is rejected: no
    /// real proof could satisfy it, so it would only create a permanently
    /// unreleasable, budget-locked task.
    ///
    /// This delegates the whole creation path to [`Self::create_task`] (auth,
    /// pause check, validation, budget lock, counter, indexing, `TaskNewEvent`)
    /// so that function stays the single source of truth and is provably
    /// unmodified — a task created through it can never carry a commitment.
    pub fn create_task_with_policy(
        env: Env,
        orchestrator: Address,
        asset: Address,
        plan_cost: i128,
        commitment: BytesN<32>,
    ) -> Result<u64, VaultError> {
        if commitment == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(VaultError::InvalidCommitment);
        }

        let task_id = Self::create_task(env.clone(), orchestrator, asset, plan_cost)?;

        let task_key = DataKey::Task(task_id);
        let mut task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("task just created");
        task.policy_commitment = Some(commitment.clone());
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);

        PolicyCommittedEvent {
            task_id,
            commitment,
        }
        .publish(&env);
        log!(
            &env,
            "create_task_with_policy id={} commitment bound",
            task_id
        );

        Ok(task_id)
    }

    /// Release funds for one step: contract transfers `amount` tokens to the ORCHESTRATOR.
    /// Returns true on success.
    ///
    /// CEI ordering: the step is recorded and `task.spent` is bumped before
    /// the external transfer. See the comment at the transfer call site —
    /// do not reorder.
    pub fn release_payment(
        env: Env,
        orchestrator: Address,
        task_id: u64,
        step_id: u64,
        asset: Address,
        amount: i128,
    ) -> Result<bool, VaultError> {
        orchestrator.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let task_key = DataKey::Task(task_id);
        let mut task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);

        // ── Mutual exclusion with the proof-gated path ───────────────────
        // A task that carries a private spending-policy commitment can ONLY be
        // released through `release_payment_proved` (with a verified proof).
        // This is the negation of the check at the top of that function; the
        // two conditions read the same single field on the same task record,
        // so exactly one path applies to any non-finalized task and neither
        // applies once it is finalized (the `completed` guard below fires).
        if task.policy_commitment.is_some() {
            return Err(VaultError::PolicyProofRequired);
        }

        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }
        if task.orchestrator != orchestrator {
            return Err(VaultError::NotYourOrchestrator);
        }
        if task.asset != asset {
            return Err(VaultError::AssetMismatch);
        }

        let step_key = DataKey::TaskStepRelease(task_id, step_id);
        if let Some(record) = env.storage().persistent().get::<_, StepRelease>(&step_key) {
            Self::extend_persistent_ttl(&env, &step_key);
            Self::extend_task_step_ids_ttl(&env, task_id);
            if record.amount == amount {
                return Ok(true);
            }
            return Err(VaultError::ReleaseConflict);
        }

        if task.spent + amount > task.plan_cost {
            return Err(VaultError::ExceedsPlanCost);
        }

        Self::record_step_release(&env, task_id, step_id, amount)?;

        Self::extend_instance_ttl(&env);

        // ── Protocol fee deduction ──────────────────────────────────────
        // Fee rounds DOWN (integer division), so the orchestrator always
        // receives the remainder. No unit of USDC is created or lost:
        //   orchestrator_payout + fee == amount (exactly).
        // A zero bps or absent recipient skips the fee path entirely,
        // making the zero-fee code path byte-for-byte equivalent to the
        // previous behavior.
        let fee = Self::compute_fee(&env, amount);
        let orchestrator_payout = amount.checked_sub(fee).expect("fee arithmetic underflow");

        // CEI ordering: task.spent and the fee accrual are both written
        // BEFORE the external token transfers below. record_step_release
        // above already makes this exact (task_id, step_id) idempotent
        // against re-entry; bumping task.spent here additionally protects
        // the task's overall plan_cost cap against a DIFFERENT step_id (or
        // a different fund-moving function, e.g. withdraw) being invoked
        // re-entrantly from inside the transfer below. Do not move the
        // transfers above this block.
        task.spent += amount;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);

        // Accrue the fee (if any) to the configured recipient's claimable balance.
        if fee > 0 {
            if let Some(fee_config) = env
                .storage()
                .instance()
                .get::<_, FeeConfig>(&DataKey::FeeConfig)
            {
                if let Some(ref recipient) = fee_config.recipient {
                    let fee_key = DataKey::AccruedFees(asset.clone());
                    let current: i128 = env.storage().instance().get(&fee_key).unwrap_or(0i128);
                    let new_accrued = current.checked_add(fee).expect("fee accrual overflow");
                    env.storage().instance().set(&fee_key, &new_accrued);

                    FeeAccruedEvent {
                        asset: asset.clone(),
                        recipient: recipient.clone(),
                        fee_amount: fee,
                        task_id,
                    }
                    .publish(&env);
                }
            }
        }

        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(
            &env.current_contract_address(),
            &orchestrator,
            &orchestrator_payout,
        );

        ReleaseEvent {
            user: task.user.clone(),
            orchestrator: orchestrator.clone(),
            task_id,
            asset: asset.clone(),
            amount,
        }
        .publish(&env);
        log!(
            &env,
            "release_payment task={} asset={} amount={} fee={} orchestrator_payout={} total_spent={}",
            task_id,
            asset,
            amount,
            fee,
            orchestrator_payout,
            task.spent
        );

        Ok(true)
    }

    /// Release funds for one step of a task that carries a **private
    /// spending-policy commitment**, gated on a zero-knowledge proof that the
    /// configured verifier accepts. This is the mirror of
    /// [`Self::release_payment`] for the committed-task path: a task created by
    /// [`Self::create_task_with_policy`] can only be paid out here, and a plain
    /// task can only be paid out via [`Self::release_payment`] — mutual
    /// exclusion is enforced at the top of both.
    ///
    /// Ordering is deliberate and load-bearing:
    /// 1. cheap local guards first — auth, pause, amount, task lookup, mutual
    ///    exclusion, lifecycle (`completed`/`disputed`), orchestrator/asset
    ///    match, step idempotency;
    /// 2. **budget check before the verifier is ever contacted** — an
    ///    over-budget request must never pay for a proof verification;
    /// 3. **nullifier-already-spent check** — a replayed nullifier is rejected
    ///    before the verifier call;
    /// 4. **verifier configured?** — if not, fail closed
    ///    ([`VaultError::PolicyVerifierNotSet`]): no call is attempted and no
    ///    funds move;
    /// 5. cross-contract `verify_policy(commitment, payee, amount, nullifier,
    ///    proof)` — only an explicit `true` authorizes the release; a `false`
    ///    returns [`VaultError::PolicyProofRejected`] and a verifier that
    ///    errors or traps reverts the whole call. Either way it fails closed,
    ///    and the nullifier is **not** marked spent on a failed verification,
    ///    so a rejected attempt cannot burn a nullifier a later legitimate
    ///    proof needs;
    /// 6. CEI — the nullifier marker, the step record, `task.spent` and the fee
    ///    accrual are all committed **before** the token transfer, exactly as
    ///    in [`Self::release_payment`].
    ///
    /// `payee` is a public input of the proof: the verifier rejects a proof
    /// generated for a different `(payee, amount)`. Funds are transferred to
    /// `payee` (fee deducted), which need not be the orchestrator — expressing
    /// "which payees the policy allows" is a core purpose of the mechanism. The
    /// caller must still be the task's registered orchestrator.
    ///
    /// The proof bytes are never logged or emitted in an event.
    ///
    /// (Wide signature: see the crate-level `too_many_arguments` allow.)
    pub fn release_payment_proved(
        env: Env,
        orchestrator: Address,
        task_id: u64,
        step_id: u64,
        asset: Address,
        amount: i128,
        payee: Address,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) -> Result<bool, VaultError> {
        orchestrator.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let task_key = DataKey::Task(task_id);
        let mut task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);

        // ── Mutual exclusion with the plain path ────────────────────────
        // This entry point serves ONLY tasks that carry a policy commitment.
        // A plain task (no commitment) must go through `release_payment`. This
        // is the exact negation of the check in that function.
        let commitment = task
            .policy_commitment
            .clone()
            .ok_or(VaultError::NoPolicyCommitment)?;

        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }
        if task.orchestrator != orchestrator {
            return Err(VaultError::NotYourOrchestrator);
        }
        if task.asset != asset {
            return Err(VaultError::AssetMismatch);
        }

        // Step idempotency — identical semantics to `release_payment`. A
        // genuine replay of an already-succeeded step is an idempotent success
        // and does NOT re-run verification or re-check the nullifier.
        let step_key = DataKey::TaskStepRelease(task_id, step_id);
        if let Some(record) = env.storage().persistent().get::<_, StepRelease>(&step_key) {
            Self::extend_persistent_ttl(&env, &step_key);
            Self::extend_task_step_ids_ttl(&env, task_id);
            Self::extend_task_nullifier_ids_ttl(&env, task_id);
            if record.amount == amount {
                return Ok(true);
            }
            return Err(VaultError::ReleaseConflict);
        }

        // (2) Budget check FIRST — cheaper than a cross-contract call, and an
        // over-budget request must never trigger proof verification.
        if task.spent + amount > task.plan_cost {
            return Err(VaultError::ExceedsPlanCost);
        }

        // (3) Replay check — a nullifier already consumed for this task is
        // rejected before the verifier is contacted.
        let nullifier_key = DataKey::TaskNullifier(task_id, nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            Self::extend_persistent_ttl(&env, &nullifier_key);
            return Err(VaultError::NullifierAlreadyUsed);
        }

        // (4) Verifier must be configured — fail closed, no call, no funds.
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::PolicyVerifier)
            .ok_or(VaultError::PolicyVerifierNotSet)?;
        Self::extend_instance_ttl(&env);

        // (5) Cross-contract verification against the [`PolicyVerifier`]
        // interface, public inputs in the fixed order
        // `(commitment, payee, amount, nullifier)` with `proof` last. ONLY an
        // explicit `true` authorizes the release; a `false` returns here as
        // `PolicyProofRejected` before a single state write, so the nullifier
        // is NOT burned by a failed verification. A verifier that errors or
        // traps reverts the whole call — also fail closed: no funds move and
        // no state is written.
        let verified = PolicyVerifierClient::new(&env, &verifier).verify_policy(
            &commitment,
            &payee,
            &amount,
            &nullifier,
            &proof,
        );
        if !verified {
            return Err(VaultError::PolicyProofRejected);
        }

        // ── EFFECTS (checks-effects-interactions) ───────────────────────
        // Everything that bounds fund movement is committed BEFORE the
        // transfer: the step record, the consumed-nullifier marker,
        // `task.spent`, and the fee accrual. A token whose `transfer`
        // re-enters this contract sees the consumed nullifier (this exact
        // proved release is now idempotent) and the bumped `task.spent`
        // (the plan_cost cap holds against any other step or fund-mover
        // invoked re-entrantly). Do not move the transfer above this block.
        Self::record_step_release(&env, task_id, step_id, amount)?;
        Self::record_task_nullifier(&env, task_id, &nullifier)?;
        Self::extend_instance_ttl(&env);

        let fee = Self::compute_fee(&env, amount);
        let payee_payout = amount.checked_sub(fee).expect("fee arithmetic underflow");

        task.spent += amount;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);

        // Accrue the fee (if any) to the configured recipient's claimable
        // balance — identical handling to `release_payment`.
        if fee > 0 {
            if let Some(fee_config) = env
                .storage()
                .instance()
                .get::<_, FeeConfig>(&DataKey::FeeConfig)
            {
                if let Some(ref recipient) = fee_config.recipient {
                    let fee_key = DataKey::AccruedFees(asset.clone());
                    let current: i128 = env.storage().instance().get(&fee_key).unwrap_or(0i128);
                    let new_accrued = current.checked_add(fee).expect("fee accrual overflow");
                    env.storage().instance().set(&fee_key, &new_accrued);

                    FeeAccruedEvent {
                        asset: asset.clone(),
                        recipient: recipient.clone(),
                        fee_amount: fee,
                        task_id,
                    }
                    .publish(&env);
                }
            }
        }

        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &payee, &payee_payout);

        ReleaseProvedEvent {
            user: task.user.clone(),
            orchestrator: orchestrator.clone(),
            task_id,
            asset: asset.clone(),
            amount,
            nullifier: nullifier.clone(),
        }
        .publish(&env);
        log!(
            &env,
            "release_payment_proved task={} asset={} amount={} fee={} payee_payout={} total_spent={}",
            task_id,
            asset,
            amount,
            fee,
            payee_payout,
            task.spent
        );

        Ok(true)
    }

    /// Orchestrator marks task complete.
    pub fn complete_task(env: Env, orchestrator: Address, task_id: u64) -> Result<(), VaultError> {
        orchestrator.require_auth();
        Self::require_task_not_disputed(&env, task_id)?;
        Self::finalize_task(&env, task_id, Some(&orchestrator), None)?;
        Ok(())
    }

    /// User cancels their own task at any time. Cancellation is blocked on a
    /// disputed task — only the dispute resolver can end one.
    pub fn cancel_task(env: Env, user: Address, task_id: u64) -> Result<(), VaultError> {
        user.require_auth();
        let task_key = DataKey::Task(task_id);
        let task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);
        if task.user != user {
            return Err(VaultError::NotYourTask);
        }
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }
        Self::finalize_task(&env, task_id, None, None)?;
        Ok(())
    }

    /// Safety escape hatch: anyone can finalize a task stuck for >30 minutes.
    /// An open dispute is never bypassed — only the resolver can end a
    /// disputed task.
    pub fn force_complete_stale_task(env: Env, task_id: u64) -> Result<(), VaultError> {
        let task_key = DataKey::Task(task_id);
        let task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);
        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }

        if !Self::is_task_stale(&env, &task) {
            return Err(VaultError::TaskNotStale);
        }

        Self::finalize_task(&env, task_id, None, None)?;
        Ok(())
    }

    // Dispute & arbitration

    /// Admin sets the dedicated `dispute_resolver` role. Only this address may
    /// settle a raised dispute. May be updated at any time; disputes raised
    /// under a previous resolver are settled by whichever resolver is set when
    /// `resolve_dispute` is called.
    pub fn set_dispute_resolver(
        env: Env,
        admin: Address,
        resolver: Address,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::DisputeResolver, &resolver);
        Self::extend_instance_ttl(&env);
        log!(&env, "Dispute resolver set to: {}", resolver);
        Ok(())
    }

    /// Returns the current dispute resolver, if one is configured.
    pub fn get_dispute_resolver(env: Env) -> Option<Address> {
        let result = env.storage().instance().get(&DataKey::DisputeResolver);
        Self::extend_instance_ttl(&env);
        result
    }

    /// The task's user raises a dispute on an active task. This freezes all
    /// further releases and completion until a configured dispute resolver
    /// settles it via `resolve_dispute`. Deliberately not gated on the pause
    /// flag so a user can always lock in a complaint while the contract is
    /// paused.
    pub fn raise_dispute(env: Env, user: Address, task_id: u64) -> Result<(), VaultError> {
        user.require_auth();
        let task_key = DataKey::Task(task_id);
        let mut task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);
        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if task.user != user {
            return Err(VaultError::NotYourTask);
        }
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }

        task.disputed = true;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);

        DisputeRaisedEvent {
            user: user.clone(),
            task_id,
        }
        .publish(&env);
        log!(&env, "raise_dispute task={} user={}", task_id, user);
        Ok(())
    }

    /// The dispute resolver settles a disputed task by splitting the still-
    /// locked remainder (`plan_cost - spent`) between the user (`refund_to_user`,
    /// sent back to the user's wallet) and the orchestrator
    /// (`payout_to_orchestrator`). Already-released `spent` is never clawed back
    /// — that is a deliberate design boundary. The task is finalized with the
    /// same accounting as `complete_task`/`cancel_task`, so `locked`, `balance`,
    /// `total_spent`, and `active_tasks_count` stay consistent.
    pub fn resolve_dispute(
        env: Env,
        resolver: Address,
        task_id: u64,
        refund_to_user: i128,
        payout_to_orchestrator: i128,
    ) -> Result<(), VaultError> {
        resolver.require_auth();
        Self::require_not_paused(&env)?;

        let task_key = DataKey::Task(task_id);
        let task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(&env, &task_key);
        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if !task.disputed {
            return Err(VaultError::TaskNotDisputed);
        }

        let stored_resolver: Option<Address> =
            env.storage().instance().get(&DataKey::DisputeResolver);
        Self::extend_instance_ttl(&env);
        match stored_resolver {
            None => return Err(VaultError::DisputeResolverNotSet),
            Some(r) if r != resolver => return Err(VaultError::NotDisputeResolver),
            Some(_) => {}
        }

        if refund_to_user < 0 || payout_to_orchestrator < 0 {
            return Err(VaultError::InvalidAmount);
        }

        let remaining_locked = task.plan_cost - task.spent;
        if refund_to_user + payout_to_orchestrator != remaining_locked {
            return Err(VaultError::DisputeSplitMismatch);
        }

        Self::finalize_task(
            &env,
            task_id,
            None,
            Some((refund_to_user, payout_to_orchestrator)),
        )?;

        DisputeResolvedEvent {
            resolver,
            task_id,
            refund_to_user,
            payout_to_orchestrator,
        }
        .publish(&env);
        log!(
            &env,
            "resolve_dispute task={} refund_to_user={} payout_to_orchestrator={}",
            task_id,
            refund_to_user,
            payout_to_orchestrator
        );
        Ok(())
    }

    // ── Protocol Fee Management ──────────────────────────────────────────

    /// Admin sets the protocol fee in basis points and the recipient address.
    ///
    /// - `bps` must be <= `MAX_FEE_BPS` (1000 = 10%).
    /// - Setting `bps` to 0 **or** passing `recipient = None` effectively
    ///   disables fee collection; `release_payment` behaves as if no fee
    ///   config exists.
    /// - Changing the fee does NOT retroactively alter already-released
    ///   amounts; only future `release_payment` calls use the new rate.
    pub fn set_fee(
        env: Env,
        admin: Address,
        bps: u32,
        recipient: Option<Address>,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }
        if bps > MAX_FEE_BPS {
            return Err(VaultError::FeeBpsExceedsCap);
        }

        let config = FeeConfig {
            bps,
            recipient: recipient.clone(),
        };
        env.storage().instance().set(&DataKey::FeeConfig, &config);
        Self::extend_instance_ttl(&env);

        FeeSetEvent {
            admin: admin.clone(),
            bps,
            recipient,
        }
        .publish(&env);
        log!(&env, "set_fee bps={}", bps);
        Ok(())
    }

    /// Returns the current fee config `(bps, recipient)`.
    /// Returns `(0, None)` when no fee has ever been configured.
    pub fn get_fee(env: Env) -> (u32, Option<Address>) {
        Self::extend_instance_ttl(&env);
        match env
            .storage()
            .instance()
            .get::<_, FeeConfig>(&DataKey::FeeConfig)
        {
            Some(c) => (c.bps, c.recipient),
            None => (0, None),
        }
    }

    /// Returns the amount of fees accrued (but not yet claimed) for `asset`.
    pub fn get_accrued_fees(env: Env, asset: Address) -> i128 {
        Self::extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get::<_, i128>(&DataKey::AccruedFees(asset))
            .unwrap_or(0)
    }

    /// Transfers all accrued fees for `asset` to the configured fee recipient.
    ///
    /// Only the configured recipient may call this. Fails with
    /// `NoFeesAccrued` if there is nothing to claim (prevents a no-op
    /// transfer). Zeroes the accrual after the transfer.
    pub fn claim_fees(env: Env, recipient: Address, asset: Address) -> Result<i128, VaultError> {
        recipient.require_auth();
        Self::require_not_paused(&env)?;

        // Verify the caller is the configured recipient.
        let fee_config: FeeConfig = env
            .storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .ok_or(VaultError::Unauthorized)?;
        match &fee_config.recipient {
            None => return Err(VaultError::Unauthorized),
            Some(r) if *r != recipient => return Err(VaultError::Unauthorized),
            Some(_) => {}
        }

        let fee_key = DataKey::AccruedFees(asset.clone());
        let accrued: i128 = env.storage().instance().get(&fee_key).unwrap_or(0);

        if accrued == 0 {
            return Err(VaultError::NoFeesAccrued);
        }

        // Zero the accrual before the transfer (checks-effects-interactions).
        env.storage().instance().set(&fee_key, &0i128);
        Self::extend_instance_ttl(&env);

        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &recipient, &accrued);

        FeeClaimedEvent {
            asset: asset.clone(),
            recipient: recipient.clone(),
            amount: accrued,
        }
        .publish(&env);
        log!(
            &env,
            "claim_fees asset={} recipient={} amount={}",
            asset,
            recipient,
            accrued
        );
        Ok(accrued)
    }

    // ── Private Spending Policy ─────────────────────────────────────────

    /// Admin sets (or replaces) the external policy-verifier contract used by
    /// [`Self::release_payment_proved`]. Mutable at any time by the admin,
    /// deliberately mirroring [`Self::set_dispute_resolver`]: a committed task
    /// is verified against whichever verifier is configured when its release is
    /// attempted.
    ///
    /// Trust note: a verifier that returned `true` unconditionally would defeat
    /// every committed task's policy. This is the same trust the contract
    /// already places in the admin elsewhere (asset whitelist, dispute
    /// resolver, protocol fee). Every change here is published as
    /// [`PolicyVerifierSetEvent`] so a swap is observable on-chain.
    pub fn set_policy_verifier(
        env: Env,
        admin: Address,
        verifier: Address,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        let old: Option<Address> = env.storage().instance().get(&DataKey::PolicyVerifier);
        env.storage()
            .instance()
            .set(&DataKey::PolicyVerifier, &verifier);
        Self::extend_instance_ttl(&env);

        PolicyVerifierSetEvent {
            admin,
            old,
            new: verifier.clone(),
        }
        .publish(&env);
        log!(&env, "Policy verifier set to: {}", verifier);
        Ok(())
    }

    /// Returns the configured policy-verifier contract, or `None` if the
    /// proof-gated release path has not been enabled.
    pub fn get_policy_verifier(env: Env) -> Option<Address> {
        let result = env.storage().instance().get(&DataKey::PolicyVerifier);
        Self::extend_instance_ttl(&env);
        result
    }

    /// Returns the private spending-policy commitment bound to `task_id` by
    /// [`Self::create_task_with_policy`], or `None` for a plainly-created task
    /// (or an unknown task). Presence of a commitment is exactly what routes a
    /// task to the proof-gated release path.
    pub fn get_task_policy(env: Env, task_id: u64) -> Option<BytesN<32>> {
        Self::get_task(env, task_id).and_then(|task| task.policy_commitment)
    }

    /// Computes the fee to deduct from `amount` based on the current fee
    /// config. Returns 0 when no fee is configured or the recipient is absent.
    ///
    /// Rounding rule: **round down** (integer division). The orchestrator
    /// always receives the remainder, so no unit of USDC is created or lost.
    /// Checked arithmetic is used throughout; overflow would require an
    /// `amount` close to `i128::MAX` which is unreachable in practice but
    /// is defended explicitly.
    fn compute_fee(env: &Env, amount: i128) -> i128 {
        let config = match env
            .storage()
            .instance()
            .get::<_, FeeConfig>(&DataKey::FeeConfig)
        {
            Some(c) => c,
            None => return 0,
        };
        // Zero bps or absent recipient → no fee.
        if config.bps == 0 || config.recipient.is_none() {
            return 0;
        }
        // fee = floor(amount * bps / 10_000)
        // Use checked multiplication to guard against absurdly large amounts.
        let numerator = amount
            .checked_mul(i128::from(config.bps))
            .expect("fee numerator overflow");
        numerator / 10_000
    }

    /// Uses the live threshold so status queries and force completion cannot drift.
    fn is_task_stale(env: &Env, task: &TaskInfo) -> bool {
        let elapsed = env.ledger().timestamp() - task.created_at;
        elapsed > Self::get_stale_threshold(env.clone())
    }

    /// Panics if the contract is paused.
    fn require_not_paused(env: &Env) -> Result<(), VaultError> {
        let paused = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        Self::extend_instance_ttl(env);
        if paused {
            return Err(VaultError::ContractPaused);
        }
        Ok(())
    }

    /// Rejects operation on a task that has an open dispute. Returns
    /// `TaskNotFound` if the task does not exist.
    fn require_task_not_disputed(env: &Env, task_id: u64) -> Result<(), VaultError> {
        let task_key = DataKey::Task(task_id);
        let task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(VaultError::TaskNotFound)?;
        Self::extend_persistent_ttl(env, &task_key);
        if task.disputed {
            return Err(VaultError::TaskDisputed);
        }
        Ok(())
    }

    /// Shared finalization logic for `complete_task`, `cancel_task`,
    /// `force_complete_stale_task`, and `resolve_dispute`. Unlocks `plan_cost`
    /// from the user's balance, deducts only the amount actually spent, and
    /// marks the task as completed.
    ///
    /// If `expected_orchestrator` is `Some`, the caller must match the task's
    /// registered orchestrator (used by `complete_task`).
    ///
    /// If `dispute_split` is `Some((refund_to_user, payout_to_orchestrator))`,
    /// the task was resolved through a dispute: the refund is sent back to the
    /// user's wallet, the payout to the orchestrator's, and the entire
    /// `plan_cost` is removed from the user's locked balance (spent already
    /// left the vault, the refund and payout are transferred now). The regular
    /// paths instead leave the unspent remainder as available balance.
    fn finalize_task(
        env: &Env,
        task_id: u64,
        expected_orchestrator: Option<&Address>,
        dispute_split: Option<(i128, i128)>,
    ) -> Result<(), VaultError> {
        let task_key = DataKey::Task(task_id);
        let mut task: TaskInfo = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");
        Self::extend_persistent_ttl(env, &task_key);
        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }

        if let Some(orch) = expected_orchestrator {
            if task.orchestrator != *orch {
                return Err(VaultError::NotYourOrchestrator);
            }
        }

        let config_key = DataKey::UserConfig(task.user.clone());
        let mut config: UserConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("User config not found");
        Self::extend_persistent_ttl(env, &config_key);

        let asset_key = DataKey::UserAsset(task.user.clone(), task.asset.clone());
        let mut asset_account: UserAssetAccount = env
            .storage()
            .persistent()
            .get(&asset_key)
            .expect("User asset account not found");
        Self::extend_persistent_ttl(env, &asset_key);

        asset_account.locked -= task.plan_cost;
        match dispute_split {
            Some((_, payout_to_orchestrator)) => {
                asset_account.balance -= task.plan_cost;
                asset_account.total_spent += task.spent + payout_to_orchestrator;
            }
            None => {
                asset_account.balance -= task.spent;
                asset_account.total_spent += task.spent;
            }
        }
        config.active_tasks_count -= 1;

        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(env, &config_key);
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(env, &asset_key);

        task.completed = true;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(env, &task_key);
        Self::remove_task_step_releases(env, task_id);
        // Prune the task's consumed-nullifier set: once the task is completed,
        // both release paths are blocked by the `completed` guard, so these
        // markers are dead weight — reclaim their rent. `policy_commitment`
        // stays on the (now completed) task record as an audit trail, mirroring
        // how `disputed` is kept; nothing refreshes it, so it lapses naturally.
        Self::remove_task_nullifiers(env, task_id);

        // CEI ordering: task.completed, asset_account, and config are all
        // committed above BEFORE the dispute-split transfers below. A token
        // whose `transfer` re-enters this contract (e.g. via a transfer
        // hook) will see task.completed == true and be rejected by the
        // guard at the top of this function, so it cannot trigger a second
        // payout for the same task. Do not move these transfers earlier.
        if let Some((refund_to_user, payout_to_orchestrator)) = dispute_split {
            let token_client = token::Client::new(env, &task.asset);
            if refund_to_user > 0 {
                token_client.transfer(&env.current_contract_address(), &task.user, &refund_to_user);
            }
            if payout_to_orchestrator > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &task.orchestrator,
                    &payout_to_orchestrator,
                );
            }
        }

        if dispute_split.is_none() {
            let refund = task.plan_cost - task.spent;
            TaskDoneEvent {
                user: task.user.clone(),
                task_id,
                asset: task.asset.clone(),
                spent: task.spent,
                refund,
            }
            .publish(env);
            log!(
                env,
                "finalize_task id={} spent={} refund={}",
                task_id,
                task.spent,
                refund
            );
        }
        Ok(())
    }

    fn record_step_release(
        env: &Env,
        task_id: u64,
        step_id: u64,
        amount: i128,
    ) -> Result<(), VaultError> {
        let ids_key = DataKey::TaskStepIds(task_id);
        let mut step_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or(Vec::new(env));

        if !step_ids.iter().any(|id| id == step_id) {
            if step_ids.len() >= MAX_RELEASE_STEPS_PER_TASK {
                return Err(VaultError::TooManyStepReleases);
            }
            step_ids.push_back(step_id);
            env.storage().persistent().set(&ids_key, &step_ids);
            Self::extend_persistent_ttl(env, &ids_key);
        }

        let step_key = DataKey::TaskStepRelease(task_id, step_id);
        env.storage()
            .persistent()
            .set(&step_key, &StepRelease { amount });
        Self::extend_persistent_ttl(env, &step_key);
        Ok(())
    }

    fn extend_task_step_ids_ttl(env: &Env, task_id: u64) {
        let ids_key = DataKey::TaskStepIds(task_id);
        let step_ids: Vec<u64> = match env.storage().persistent().get(&ids_key) {
            Some(ids) => ids,
            None => return,
        };
        Self::extend_persistent_ttl(env, &ids_key);
        for step_id in step_ids.iter() {
            let step_key = DataKey::TaskStepRelease(task_id, step_id);
            if env.storage().persistent().has(&step_key) {
                Self::extend_persistent_ttl(env, &step_key);
            }
        }
    }

    fn remove_task_step_releases(env: &Env, task_id: u64) {
        let ids_key = DataKey::TaskStepIds(task_id);
        let step_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or(Vec::new(env));
        for step_id in step_ids.iter() {
            let step_key = DataKey::TaskStepRelease(task_id, step_id);
            if env.storage().persistent().has(&step_key) {
                env.storage().persistent().remove(&step_key);
            }
        }
        if env.storage().persistent().has(&ids_key) {
            env.storage().persistent().remove(&ids_key);
        }
    }

    /// Marks `nullifier` as consumed for `task_id` and appends it to the
    /// per-task nullifier index. Mirrors [`Self::record_step_release`]: the
    /// index is bounded by `MAX_RELEASE_STEPS_PER_TASK` (a task can never
    /// release more steps than that) so a hostile orchestrator cannot mint
    /// unbounded persistent keys, and it is removed wholesale on finalization.
    /// The caller has already verified the marker is absent; the dedup scan
    /// here only guards the index against a double push.
    fn record_task_nullifier(
        env: &Env,
        task_id: u64,
        nullifier: &BytesN<32>,
    ) -> Result<(), VaultError> {
        let ids_key = DataKey::TaskNullifierIds(task_id);
        let mut ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or(Vec::new(env));

        if !ids.iter().any(|id| &id == nullifier) {
            if ids.len() >= MAX_RELEASE_STEPS_PER_TASK {
                return Err(VaultError::TooManyStepReleases);
            }
            ids.push_back(nullifier.clone());
            env.storage().persistent().set(&ids_key, &ids);
            Self::extend_persistent_ttl(env, &ids_key);
        }

        let key = DataKey::TaskNullifier(task_id, nullifier.clone());
        env.storage().persistent().set(&key, &());
        Self::extend_persistent_ttl(env, &key);
        Ok(())
    }

    /// Refreshes the TTL of a task's whole nullifier set as one unit — the
    /// index and every marker it references — so no part expires alone and
    /// re-opens a replay. Mirrors [`Self::extend_task_step_ids_ttl`].
    fn extend_task_nullifier_ids_ttl(env: &Env, task_id: u64) {
        let ids_key = DataKey::TaskNullifierIds(task_id);
        let ids: Vec<BytesN<32>> = match env.storage().persistent().get(&ids_key) {
            Some(ids) => ids,
            None => return,
        };
        Self::extend_persistent_ttl(env, &ids_key);
        for nullifier in ids.iter() {
            let key = DataKey::TaskNullifier(task_id, nullifier);
            if env.storage().persistent().has(&key) {
                Self::extend_persistent_ttl(env, &key);
            }
        }
    }

    /// Removes a task's consumed-nullifier markers and their index. Called
    /// from [`Self::finalize_task`]; mirrors [`Self::remove_task_step_releases`].
    fn remove_task_nullifiers(env: &Env, task_id: u64) {
        let ids_key = DataKey::TaskNullifierIds(task_id);
        let ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or(Vec::new(env));
        for nullifier in ids.iter() {
            let key = DataKey::TaskNullifier(task_id, nullifier);
            if env.storage().persistent().has(&key) {
                env.storage().persistent().remove(&key);
            }
        }
        if env.storage().persistent().has(&ids_key) {
            env.storage().persistent().remove(&ids_key);
        }
    }

    /// Loads the user's asset account balance, or returns a zeroed struct if not found.
    fn get_or_create_asset_account(env: &Env, user: &Address, asset: &Address) -> UserAssetAccount {
        let key = DataKey::UserAsset(user.clone(), asset.clone());
        let account = env
            .storage()
            .persistent()
            .get::<_, UserAssetAccount>(&key)
            .unwrap_or(UserAssetAccount {
                balance: 0,
                locked: 0,
                total_deposited: 0,
                total_spent: 0,
                created_at: env.ledger().timestamp(),
            });
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(env, &key);
        }
        account
    }

    /// Loads the user's config, or returns a fresh zeroed [`UserConfig`] if not found.
    fn get_or_create_config(env: &Env, user: &Address) -> UserConfig {
        let key = DataKey::UserConfig(user.clone());
        let config = env
            .storage()
            .persistent()
            .get::<_, UserConfig>(&key)
            .unwrap_or(UserConfig {
                orchestrator: None,
                orchestrator_name: String::from_str(env, ""),
                active_tasks_count: 0,
                created_at: env.ledger().timestamp(),
            });
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(env, &key);
        }
        config
    }

    /// Appends `asset` to the enumerable [`DataKey::SupportedAssets`] index.
    /// Idempotent — an asset already present is not duplicated.
    fn index_add_asset(env: &Env, asset: &Address) {
        let key = DataKey::SupportedAssets;
        let mut assets: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));
        if !assets.iter().any(|a| a == *asset) {
            assets.push_back(asset.clone());
            env.storage().persistent().set(&key, &assets);
            Self::extend_persistent_ttl(env, &key);
        }
    }

    /// Removes `asset` from the enumerable [`DataKey::SupportedAssets`] index.
    /// A no-op if the asset is not present.
    fn index_remove_asset(env: &Env, asset: &Address) {
        let key = DataKey::SupportedAssets;
        let assets: Vec<Address> = match env.storage().persistent().get(&key) {
            Some(a) => a,
            None => return,
        };
        if let Some(index) = assets.iter().position(|a| a == *asset) {
            let mut assets = assets;
            assets.remove(index as u32);
            env.storage().persistent().set(&key, &assets);
            Self::extend_persistent_ttl(env, &key);
        }
    }

    /// Refreshes the TTLs of the entire asset-support state as one unit: the
    /// enumerable [`DataKey::SupportedAssets`] index and every per-asset
    /// [`DataKey::AssetSupported`] flag it references. Every path that reads or
    /// mutates support state funnels through this, so the index and the flags
    /// always share a single TTL lifecycle. Without it, whichever representation
    /// a given call happened to touch would be refreshed alone; the other could
    /// expire first, leaving `is_supported_asset` and `get_supported_assets`
    /// disagreeing — and a later `index_add_asset` rebuilding a fresh index
    /// could silently drop a still-supported asset.
    fn extend_asset_support_ttl(env: &Env) {
        let key = DataKey::SupportedAssets;
        let assets: Vec<Address> = match env.storage().persistent().get(&key) {
            Some(a) => a,
            None => return,
        };
        Self::extend_persistent_ttl(env, &key);
        for asset in assets.iter() {
            let asset_key = DataKey::AssetSupported(asset);
            if env.storage().persistent().has(&asset_key) {
                Self::extend_persistent_ttl(env, &asset_key);
            }
        }
    }

    fn extend_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    // Read-only views

    /// The vault's actual token balance for `asset`, read from the SAC.
    pub fn token_balance(env: Env, asset: Address) -> i128 {
        let token_client = token::Client::new(&env, &asset);
        token_client.balance(&env.current_contract_address())
    }

    /// Total balance for user and asset (available + locked), in stroops.
    pub fn get_balance(env: Env, user: Address, asset: Address) -> i128 {
        let key = DataKey::UserAsset(user, asset);
        let result = env
            .storage()
            .persistent()
            .get::<_, UserAssetAccount>(&key)
            .map(|a| a.balance)
            .unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Available (non-locked) balance for user and asset, in stroops.
    pub fn get_available(env: Env, user: Address, asset: Address) -> i128 {
        let key = DataKey::UserAsset(user, asset);
        let result = env
            .storage()
            .persistent()
            .get::<_, UserAssetAccount>(&key)
            .map(|a| a.balance - a.locked)
            .unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Full account record for a user and asset (balance, locked, orchestrator, etc.).
    pub fn get_account(env: Env, user: Address, asset: Address) -> Option<UserAccount> {
        let asset_key = DataKey::UserAsset(user.clone(), asset);
        let asset_account: Option<UserAssetAccount> = env.storage().persistent().get(&asset_key);
        if env.storage().persistent().has(&asset_key) {
            Self::extend_persistent_ttl(&env, &asset_key);
        }

        let config_key = DataKey::UserConfig(user.clone());
        let config: Option<UserConfig> = env.storage().persistent().get(&config_key);
        if env.storage().persistent().has(&config_key) {
            Self::extend_persistent_ttl(&env, &config_key);
        }

        match (asset_account, config) {
            (Some(a), Some(c)) => Some(UserAccount {
                balance: a.balance,
                locked: a.locked,
                total_deposited: a.total_deposited,
                total_spent: a.total_spent,
                active_tasks_count: c.active_tasks_count,
                orchestrator: c.orchestrator,
                orchestrator_name: c.orchestrator_name,
                created_at: a.created_at,
            }),
            (Some(a), None) => Some(UserAccount {
                balance: a.balance,
                locked: a.locked,
                total_deposited: a.total_deposited,
                total_spent: a.total_spent,
                active_tasks_count: 0,
                orchestrator: None,
                orchestrator_name: String::from_str(&env, ""),
                created_at: a.created_at,
            }),
            (None, Some(c)) => Some(UserAccount {
                balance: 0,
                locked: 0,
                total_deposited: 0,
                total_spent: 0,
                active_tasks_count: c.active_tasks_count,
                orchestrator: c.orchestrator,
                orchestrator_name: c.orchestrator_name,
                created_at: c.created_at,
            }),
            (None, None) => None,
        }
    }

    /// Asset-agnostic user configuration (orchestrator registration, active tasks).
    pub fn get_user_config(env: Env, user: Address) -> Option<UserConfig> {
        let key = DataKey::UserConfig(user);
        let result = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Full task record by task_id.
    pub fn get_task(env: Env, task_id: u64) -> Option<TaskInfo> {
        let key = DataKey::Task(task_id);
        let result = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Returns the task's lifecycle state at the current ledger timestamp.
    pub fn get_task_status(env: Env, task_id: u64) -> Option<TaskStatus> {
        let key = DataKey::Task(task_id);
        let task: TaskInfo = env.storage().persistent().get(&key)?;
        Self::extend_persistent_ttl(&env, &key);

        if task.completed {
            Some(TaskStatus::Completed)
        } else if task.disputed {
            Some(TaskStatus::Disputed)
        } else if Self::is_task_stale(&env, &task) {
            Some(TaskStatus::Stale)
        } else {
            Some(TaskStatus::Active)
        }
    }

    pub fn get_user_tasks(env: Env, user: Address) -> soroban_sdk::Vec<u64> {
        let key = DataKey::UserTasks(user);
        let result = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(soroban_sdk::Vec::new(&env));
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Returns a page of a user's full task records in creation order.
    ///
    /// `start` is an index into the user's task ID list, not a task ID. Page
    /// size is capped at 50 to bound contract resource usage. An out-of-range
    /// `start` or a user with no tasks returns an empty vector.
    pub fn get_user_task_infos(
        env: Env,
        user: Address,
        start: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<TaskInfo> {
        let ids = Self::get_user_tasks(env.clone(), user);
        let mut out = soroban_sdk::Vec::new(&env);
        let capped = limit.min(MAX_USER_TASK_INFOS_PAGE_SIZE);
        let end = start.saturating_add(capped).min(ids.len());
        let mut i = start;

        while i < end {
            if let Some(id) = ids.get(i) {
                if let Some(task) = Self::get_task(env.clone(), id) {
                    out.push_back(task);
                }
            }
            i += 1;
        }

        out
    }

    /// Reverse lookup: given an orchestrator address, return the user it belongs to.
    pub fn get_orchestrator_owner(env: Env, orchestrator: Address) -> Option<Address> {
        let key = DataKey::OrchestratorOwner(orchestrator);
        let result = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_persistent_ttl(&env, &key);
        }
        result
    }

    /// Total number of tasks ever created across all users.
    pub fn task_count(env: Env) -> u64 {
        let result = env
            .storage()
            .instance()
            .get(&DataKey::TaskCounter)
            .unwrap_or(0);
        Self::extend_instance_ttl(&env);
        result
    }

    // ── Pause / Unpause ─────────────────────────────────────────────────

    /// Pauses the contract, blocking deposit, create_task, and release_payment.
    pub fn pause(env: Env, admin: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        Self::extend_instance_ttl(&env);
        PauseEvent {
            admin: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Unpauses the contract, restoring normal operation.
    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
        UnpauseEvent {
            admin: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Returns true if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        let paused = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        Self::extend_instance_ttl(&env);
        paused
    }

    // ── Stale Task Threshold Management ────────────────────────────────

    /// Admin updates the threshold (in seconds) after which a task is considered stale.
    pub fn set_stale_threshold(env: Env, admin: Address, seconds: u64) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        if seconds < 60 {
            // "Threshold must be at least 60 seconds"
            return Err(VaultError::InvalidAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::StaleTaskThreshold, &seconds);
        Self::extend_instance_ttl(&env);
        log!(&env, "Stale task threshold updated to: {} seconds", seconds);
        Ok(())
    }

    /// Returns the current stale task threshold in seconds.
    pub fn get_stale_threshold(env: Env) -> u64 {
        let threshold = env
            .storage()
            .instance()
            .get(&DataKey::StaleTaskThreshold)
            .unwrap_or(STALE_TASK_THRESHOLD_SECONDS);
        Self::extend_instance_ttl(&env);
        threshold
    }

    // ── Max Active Tasks Management ────────────────────────────────────

    /// Admin updates the cap on concurrent active tasks a single user may hold.
    pub fn set_max_active_tasks(env: Env, admin: Address, max: u32) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }

        if max < 1 {
            // A cap of 0 would freeze all task creation for every user.
            return Err(VaultError::InvalidAmount);
        }

        env.storage().instance().set(&DataKey::MaxActiveTasks, &max);
        Self::extend_instance_ttl(&env);
        log!(&env, "Max active tasks updated to: {}", max);
        Ok(())
    }

    /// Returns the current cap on concurrent active tasks per user.
    pub fn get_max_active_tasks(env: Env) -> u32 {
        let max = env
            .storage()
            .instance()
            .get(&DataKey::MaxActiveTasks)
            .unwrap_or(DEFAULT_MAX_ACTIVE_TASKS);
        Self::extend_instance_ttl(&env);
        max
    }

    /// Rotates the admin key. Only the current admin can call this.
    /// Emits UpdateAdminEvent on success.
    pub fn update_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VaultError::Unauthorized)?;
        if admin != stored_admin {
            return Err(VaultError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Self::extend_instance_ttl(&env);
        UpdateAdminEvent {
            old_admin: admin,
            new_admin,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Returns the compile-time `CONTRACT_VERSION` of this deployment.
    ///
    /// Lets operators and clients cheaply confirm which build of
    /// CleverVault a given address is running before assuming a given
    /// function or storage layout exists.
    pub fn version(env: Env) -> u32 {
        Self::extend_instance_ttl(&env);
        CONTRACT_VERSION
    }
}

#[cfg(test)]
mod tests;
