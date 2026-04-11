#![no_std]
//! AgentVault — Soroban smart contract (v2)
//!
//! Trustless treasury for AgentForge. Holds USDC for multiple users,
//! manages per-user balances, registers personal orchestrators, and
//! releases per-step payments to orchestrators during task execution.
//!
//! Funds flow: User wallet → deposit() → contract
//!             contract → release_payment() → orchestrator wallet
//!             orchestrator → x402 → agent wallet
//!
//! The orchestrator is a relay: it briefly holds USDC for each step,
//! pays the agent via standard x402, and returns to ~0 USDC balance.

use soroban_sdk::{contract, contractimpl, contracttype, log, symbol_short, token, Address, Env, String};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    UsdcSac,                        // USDC Stellar Asset Contract address
    User(Address),                  // user address → UserAccount
    Task(u64),                      // task_id → TaskInfo
    TaskCounter,
    OrchestratorOwner(Address),     // orchestrator address → user address (reverse lookup)
}

// ── Data structs ──────────────────────────────────────────────────────────────

/// Per-user account state. Created on first deposit or register_orchestrator.
#[contracttype]
#[derive(Clone)]
pub struct UserAccount {
    pub balance: i128,              // total USDC held (available + locked), in stroops
    pub locked: i128,               // portion reserved for active tasks
    pub total_deposited: i128,      // lifetime deposits, for analytics
    pub total_spent: i128,          // lifetime task spending, for analytics
    pub active_tasks_count: u32,    // must be 0 for new task or withdrawal
    pub orchestrator: Option<Address>,
    pub orchestrator_name: String,
    pub created_at: u64,
}

/// Per-task state, written by create_task and updated by release_payment/complete_task.
#[contracttype]
#[derive(Clone)]
pub struct TaskInfo {
    pub user: Address,
    pub orchestrator: Address,
    pub plan_cost: i128,            // total budget locked for this task, in stroops
    pub spent: i128,                // amount released so far
    pub completed: bool,
    pub created_at: u64,
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Tasks older than this that haven't completed can be force-finalized by anyone.
const STALE_TASK_THRESHOLD_SECONDS: u64 = 1800; // 30 minutes

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AgentVault;

#[contractimpl]
impl AgentVault {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time init — sets admin and USDC SAC address. Panics if called twice.
    pub fn init(env: Env, admin: Address, usdc_sac: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcSac, &usdc_sac);
        env.storage().instance().set(&DataKey::TaskCounter, &0u64);
        log!(&env, "AgentVault initialized admin={} usdc_sac={}", admin, usdc_sac);
    }

    // ── Deposits & Withdrawals ────────────────────────────────────────────────

    /// Deposit USDC from user's external wallet into their vault balance.
    /// Creates the user account on first deposit.
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "Deposit must be positive");

        let usdc_sac: Address = env.storage().instance().get(&DataKey::UsdcSac).unwrap();
        let usdc = token::Client::new(&env, &usdc_sac);
        // Transfer USDC from user → contract. User must have approved this.
        usdc.transfer(&user, &env.current_contract_address(), &amount);

        let mut account = Self::get_or_create_account(&env, &user);
        account.balance += amount;
        account.total_deposited += amount;
        env.storage().persistent().set(&DataKey::User(user.clone()), &account);

        env.events().publish((symbol_short!("deposit"), user.clone()), amount);
        log!(&env, "deposit user={} amount={} new_balance={}", user, amount, account.balance);
    }

    /// Withdraw USDC from vault back to user's external wallet.
    /// BLOCKED while any task is active (active_tasks_count > 0).
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "Withdrawal must be positive");

        let mut account: UserAccount = env.storage().persistent()
            .get(&DataKey::User(user.clone()))
            .expect("No account");

        assert!(
            account.active_tasks_count == 0,
            "Cannot withdraw while tasks are active"
        );
        assert!(account.balance >= amount, "Insufficient balance");

        let usdc_sac: Address = env.storage().instance().get(&DataKey::UsdcSac).unwrap();
        let usdc = token::Client::new(&env, &usdc_sac);
        usdc.transfer(&env.current_contract_address(), &user, &amount);

        account.balance -= amount;
        env.storage().persistent().set(&DataKey::User(user.clone()), &account);

        env.events().publish((symbol_short!("withdraw"), user.clone()), amount);
        log!(&env, "withdraw user={} amount={} remaining={}", user, amount, account.balance);
    }

    // ── Orchestrator registration ─────────────────────────────────────────────

    /// Register a personal orchestrator for this user. ONE-TIME per user.
    /// The user signs this transaction — the orchestrator address is stored on-chain.
    pub fn register_orchestrator(
        env: Env,
        user: Address,
        orchestrator: Address,
        name: String,
    ) {
        user.require_auth();

        let mut account = Self::get_or_create_account(&env, &user);

        assert!(
            account.orchestrator.is_none(),
            "Orchestrator already registered for this user"
        );

        account.orchestrator = Some(orchestrator.clone());
        account.orchestrator_name = name.clone();
        env.storage().persistent().set(&DataKey::User(user.clone()), &account);

        // Reverse lookup: orchestrator address → user address
        env.storage().persistent().set(
            &DataKey::OrchestratorOwner(orchestrator.clone()),
            &user,
        );

        env.events().publish((symbol_short!("regOrch"), user.clone()), orchestrator.clone());
        log!(&env, "register_orchestrator user={} orchestrator={}", user, orchestrator);
    }

    // ── Task lifecycle ────────────────────────────────────────────────────────

    /// Orchestrator creates a task, locking plan_cost from user's available balance.
    /// Returns the new task_id. Only one active task per user at a time.
    pub fn create_task(
        env: Env,
        orchestrator: Address,
        plan_cost: i128,
    ) -> u64 {
        orchestrator.require_auth();
        assert!(plan_cost > 0, "Plan cost must be positive");

        // Resolve orchestrator → user
        let user: Address = env.storage().persistent()
            .get(&DataKey::OrchestratorOwner(orchestrator.clone()))
            .expect("Orchestrator not registered");

        let mut account: UserAccount = env.storage().persistent()
            .get(&DataKey::User(user.clone()))
            .expect("User account not found");

        assert!(
            account.active_tasks_count == 0,
            "User already has an active task"
        );

        let available = account.balance - account.locked;
        assert!(available >= plan_cost, "Insufficient available balance");

        account.locked += plan_cost;
        account.active_tasks_count += 1;
        env.storage().persistent().set(&DataKey::User(user.clone()), &account);

        let mut counter: u64 = env.storage().instance()
            .get(&DataKey::TaskCounter)
            .unwrap_or(0);
        counter += 1;

        let task = TaskInfo {
            user: user.clone(),
            orchestrator: orchestrator.clone(),
            plan_cost,
            spent: 0,
            completed: false,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Task(counter), &task);
        env.storage().instance().set(&DataKey::TaskCounter, &counter);

        env.events().publish(
            (symbol_short!("taskNew"), user.clone(), orchestrator.clone()),
            (counter, plan_cost),
        );
        log!(&env, "create_task id={} orchestrator={} plan_cost={}", counter, orchestrator, plan_cost);

        counter
    }

    /// Release funds for one step: contract transfers `amount` USDC to the ORCHESTRATOR.
    /// The orchestrator then pays the agent via standard x402 (unchanged from Phase 9).
    /// Returns true on success.
    pub fn release_payment(
        env: Env,
        orchestrator: Address,
        task_id: u64,
        amount: i128,
    ) -> bool {
        orchestrator.require_auth();
        assert!(amount > 0, "Amount must be positive");

        let mut task: TaskInfo = env.storage().persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        assert!(!task.completed, "Task already completed");
        assert!(task.orchestrator == orchestrator, "Not authorized for this task");
        assert!(task.spent + amount <= task.plan_cost, "Exceeds plan cost");

        // Transfer USDC: contract → orchestrator wallet (NOT directly to agent)
        let usdc_sac: Address = env.storage().instance().get(&DataKey::UsdcSac).unwrap();
        let usdc = token::Client::new(&env, &usdc_sac);
        usdc.transfer(&env.current_contract_address(), &orchestrator, &amount);

        task.spent += amount;
        env.storage().persistent().set(&DataKey::Task(task_id), &task);

        env.events().publish(
            (symbol_short!("release"), task.user.clone(), orchestrator.clone()),
            (task_id, amount),
        );
        log!(&env, "release_payment task={} amount={} total_spent={}", task_id, amount, task.spent);

        true
    }

    /// Orchestrator marks task complete.
    /// Unlocks plan_cost from user balance, deducts only what was actually spent.
    /// Any unused locked amount is returned to user's available balance.
    pub fn complete_task(env: Env, orchestrator: Address, task_id: u64) {
        orchestrator.require_auth();
        Self::finalize_task(&env, task_id, Some(&orchestrator));
    }

    /// User cancels their own task at any time.
    /// Full refund of unspent locked amount.
    pub fn cancel_task(env: Env, user: Address, task_id: u64) {
        user.require_auth();
        let task: TaskInfo = env.storage().persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");
        assert!(task.user == user, "Not your task");
        Self::finalize_task(&env, task_id, None);
    }

    /// Safety escape hatch: anyone can finalize a task stuck for >30 minutes.
    /// Does not transfer any funds — only restores user's balance accounting.
    pub fn force_complete_stale_task(env: Env, task_id: u64) {
        let task: TaskInfo = env.storage().persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");
        assert!(!task.completed, "Task already completed");

        let now = env.ledger().timestamp();
        let elapsed = now - task.created_at;
        assert!(
            elapsed > STALE_TASK_THRESHOLD_SECONDS,
            "Task is not stale yet"
        );

        Self::finalize_task(&env, task_id, None);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn finalize_task(env: &Env, task_id: u64, expected_orchestrator: Option<&Address>) {
        let mut task: TaskInfo = env.storage().persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");
        assert!(!task.completed, "Already completed");

        if let Some(orch) = expected_orchestrator {
            assert!(task.orchestrator == *orch, "Not authorized");
        }

        let mut account: UserAccount = env.storage().persistent()
            .get(&DataKey::User(task.user.clone()))
            .expect("User not found");

        // Unlock plan_cost from locked, deduct only actual spend from balance.
        // Refund = plan_cost - spent is implicitly restored to available balance.
        account.locked -= task.plan_cost;
        account.balance -= task.spent;
        account.total_spent += task.spent;
        account.active_tasks_count -= 1;
        env.storage().persistent().set(&DataKey::User(task.user.clone()), &account);

        task.completed = true;
        env.storage().persistent().set(&DataKey::Task(task_id), &task);

        let refund = task.plan_cost - task.spent;
        env.events().publish(
            (symbol_short!("taskDone"), task.user.clone()),
            (task_id, task.spent, refund),
        );
        log!(&env, "finalize_task id={} spent={} refund={}", task_id, task.spent, refund);
    }

    fn get_or_create_account(env: &Env, user: &Address) -> UserAccount {
        env.storage().persistent()
            .get::<_, UserAccount>(&DataKey::User(user.clone()))
            .unwrap_or(UserAccount {
                balance: 0,
                locked: 0,
                total_deposited: 0,
                total_spent: 0,
                active_tasks_count: 0,
                orchestrator: None,
                orchestrator_name: String::from_str(env, ""),
                created_at: env.ledger().timestamp(),
            })
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Total USDC balance for user (available + locked), in stroops.
    pub fn get_balance(env: Env, user: Address) -> i128 {
        env.storage().persistent()
            .get::<_, UserAccount>(&DataKey::User(user))
            .map(|a| a.balance)
            .unwrap_or(0)
    }

    /// Available (non-locked) USDC for user, in stroops.
    pub fn get_available(env: Env, user: Address) -> i128 {
        env.storage().persistent()
            .get::<_, UserAccount>(&DataKey::User(user))
            .map(|a| a.balance - a.locked)
            .unwrap_or(0)
    }

    /// Full account record for a user (balance, locked, orchestrator, etc.).
    pub fn get_account(env: Env, user: Address) -> Option<UserAccount> {
        env.storage().persistent().get(&DataKey::User(user))
    }

    /// Full task record by task_id.
    pub fn get_task(env: Env, task_id: u64) -> Option<TaskInfo> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    /// Reverse lookup: given an orchestrator address, return the user it belongs to.
    pub fn get_orchestrator_owner(env: Env, orchestrator: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::OrchestratorOwner(orchestrator))
    }

    /// Total number of tasks ever created across all users.
    pub fn task_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TaskCounter).unwrap_or(0)
    }
}
