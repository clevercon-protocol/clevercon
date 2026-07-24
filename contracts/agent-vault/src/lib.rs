#![no_std]
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
    contract, contractevent, contractimpl, contracttype, log, token, Address, Env, String, Vec,
};

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
    NoChange = 19,
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
    /// Ledger timestamp when this task was created.
    pub created_at: u64,
}

// Constants

/// Tasks older than this that haven't completed can be force-finalized by anyone.
const STALE_TASK_THRESHOLD_SECONDS: u64 = 1800; // 30 minutes

/// Default cap on concurrent active tasks per user. Normal usage — even an
/// orchestrator juggling several in-flight plans for one user — sits well
/// under this; it exists to bound storage growth from a buggy or hostile
/// orchestrator, not to constrain everyday behavior.
const DEFAULT_MAX_ACTIVE_TASKS: u32 = 50;

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
const CONTRACT_VERSION: u32 = 2;

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
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        asset_account.balance -= amount;
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(&env, &asset_key);

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
    /// Rejects if new_orchestrator equals the current orchestrator (no-op check).
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

        if config.active_tasks_count != 0 {
            return Err(VaultError::ActiveTaskExists);
        }

        let old_orchestrator = config
            .orchestrator
            .clone()
            .ok_or(VaultError::OrchestratorNotRegistered)?;

        let new_owner_key = DataKey::OrchestratorOwner(new_orchestrator.clone());
        if let Some(existing_owner) = env.storage().persistent().get::<_, Address>(&new_owner_key) {
            if existing_owner != user {
                return Err(VaultError::OrchestratorAlreadyRegistered);
            }
        }

        // Reject no-op rotation: new_orchestrator must differ from old orchestrator
        // This check comes BEFORE any TTL refreshes or state mutations
        if new_orchestrator == old_orchestrator {
            return Err(VaultError::NoChange);
        }

        // All validations passed; now refresh TTLs and perform state writes
        Self::extend_persistent_ttl(&env, &config_key);

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

    /// Release funds for one step: contract transfers `amount` tokens to the ORCHESTRATOR.
    /// Returns true on success.
    pub fn release_payment(
        env: Env,
        orchestrator: Address,
        task_id: u64,
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

        if task.completed {
            return Err(VaultError::TaskAlreadyCompleted);
        }
        if task.orchestrator != orchestrator {
            return Err(VaultError::NotYourOrchestrator);
        }
        if task.asset != asset {
            return Err(VaultError::AssetMismatch);
        }
        if task.spent + amount > task.plan_cost {
            return Err(VaultError::ExceedsPlanCost);
        }

        Self::extend_instance_ttl(&env);
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &orchestrator, &amount);

        task.spent += amount;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(&env, &task_key);

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
            "release_payment task={} asset={} amount={} total_spent={}",
            task_id,
            asset,
            amount,
            task.spent
        );

        Ok(true)
    }

    /// Orchestrator marks task complete.
    pub fn complete_task(env: Env, orchestrator: Address, task_id: u64) -> Result<(), VaultError> {
        orchestrator.require_auth();
        Self::finalize_task(&env, task_id, Some(&orchestrator))?;
        Ok(())
    }

    /// User cancels their own task at any time.
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
        Self::finalize_task(&env, task_id, None)?;
        Ok(())
    }

    /// Safety escape hatch: anyone can finalize a task stuck for >30 minutes.
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

        let now = env.ledger().timestamp();
        let elapsed = now - task.created_at;
        let threshold = Self::get_stale_threshold(env.clone());
        if elapsed <= threshold {
            return Err(VaultError::TaskNotStale);
        }

        Self::finalize_task(&env, task_id, None)?;
        Ok(())
    }

    // Internal helpers

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

    /// Shared finalization logic for `complete_task`, `cancel_task`, and
    /// `force_complete_stale_task`. Unlocks `plan_cost` from the user's balance,
    /// deducts only the amount actually spent, and marks the task as completed.
    ///
    /// If `expected_orchestrator` is `Some`, the caller must match the task's
    /// registered orchestrator (used by `complete_task`).
    fn finalize_task(
        env: &Env,
        task_id: u64,
        expected_orchestrator: Option<&Address>,
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
        asset_account.balance -= task.spent;
        asset_account.total_spent += task.spent;
        config.active_tasks_count -= 1;

        env.storage().persistent().set(&config_key, &config);
        Self::extend_persistent_ttl(env, &config_key);
        env.storage().persistent().set(&asset_key, &asset_account);
        Self::extend_persistent_ttl(env, &asset_key);

        task.completed = true;
        env.storage().persistent().set(&task_key, &task);
        Self::extend_persistent_ttl(env, &task_key);

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
        Ok(())
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
    /// Rejects if new_admin equals the current admin (no-op check).
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
        // Reject no-op rotation: new_admin must differ from current admin
        if new_admin == stored_admin {
            return Err(VaultError::NoChange);
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
