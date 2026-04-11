#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, log, Address, Env};

/// Persistent storage keys
#[contracttype]
pub enum DataKey {
    Admin,
    TaskCounter,
    Task(u64),
}

/// On-chain task budget record
#[contracttype]
#[derive(Clone)]
pub struct Task {
    pub owner: Address,
    pub budget: i128,   // in stroops (1 USDC = 10_000_000 stroops)
    pub spent: i128,
    pub num_payments: u32,
    pub completed: bool,
    pub created_at: u64,
}

#[contract]
pub struct BudgetGuardian;

#[contractimpl]
impl BudgetGuardian {
    /// One-time initialisation — sets the admin address.
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        // Only allow init once
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TaskCounter, &0u64);
        log!(&env, "BudgetGuardian initialised, admin={}", admin);
    }

    /// Create a new task budget. Returns the task_id (monotonically increasing).
    /// budget is in stroops (multiply USDC by 10_000_000).
    pub fn create_task(env: Env, owner: Address, budget: i128) -> u64 {
        owner.require_auth();
        assert!(budget > 0, "budget must be positive");

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TaskCounter)
            .unwrap_or(0);
        counter += 1;

        let task = Task {
            owner: owner.clone(),
            budget,
            spent: 0,
            num_payments: 0,
            completed: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Task(counter), &task);
        env.storage()
            .instance()
            .set(&DataKey::TaskCounter, &counter);

        log!(
            &env,
            "Task {} created: owner={} budget={}",
            counter,
            owner,
            budget
        );
        counter
    }

    /// Approve a spend against a task budget.
    /// Returns true if approved, false if it would exceed the budget.
    pub fn approve_spend(env: Env, owner: Address, task_id: u64, amount: i128) -> bool {
        owner.require_auth();
        assert!(amount > 0, "amount must be positive");

        let mut task: Task = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("task not found");

        assert!(!task.completed, "task already completed");
        assert!(task.owner == owner, "not the task owner");

        if task.spent + amount > task.budget {
            log!(
                &env,
                "DENIED task={} spent={} amount={} budget={}",
                task_id,
                task.spent,
                amount,
                task.budget
            );
            return false;
        }

        task.spent += amount;
        task.num_payments += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Task(task_id), &task);

        log!(
            &env,
            "APPROVED task={} amount={} spent={} remaining={}",
            task_id,
            amount,
            task.spent,
            task.budget - task.spent
        );
        true
    }

    /// Mark a task as complete. No more spends will be approved after this.
    pub fn complete_task(env: Env, owner: Address, task_id: u64) {
        owner.require_auth();
        let mut task: Task = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("task not found");
        assert!(task.owner == owner, "not the task owner");
        assert!(!task.completed, "already completed");
        task.completed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Task(task_id), &task);
        log!(&env, "Task {} completed: spent={} of {}", task_id, task.spent, task.budget);
    }

    /// Read a full task record.
    pub fn get_task(env: Env, task_id: u64) -> Task {
        env.storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("task not found")
    }

    /// Remaining budget for a task (in stroops).
    pub fn get_remaining(env: Env, task_id: u64) -> i128 {
        let task: Task = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("task not found");
        task.budget - task.spent
    }

    /// Total number of tasks created.
    pub fn task_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TaskCounter)
            .unwrap_or(0)
    }
}
