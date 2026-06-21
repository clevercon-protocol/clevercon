use crate::{AgentVault, AgentVaultClient, DataKey};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

struct TestEnv {
    env: Env,
    admin: Address,
    usdc_sac: Address,
    contract_id: Address,
    client: AgentVaultClient<'static>,
    token_client: token::Client<'static>,
    token_admin_client: token::StellarAssetClient<'static>,
}

fn setup_test() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Register the Stellar Asset Contract
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_sac = sac.address();

    // Deploy AgentVault contract
    let contract_id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &contract_id);

    let token_client = token::Client::new(&env, &usdc_sac);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc_sac);

    TestEnv {
        env,
        admin,
        usdc_sac,
        contract_id,
        client,
        token_client,
        token_admin_client,
    }
}

// ── 1. Init Tests ────────────────────────────────────────────────────────────

#[test]
fn test_init() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // Verify admin and USDC SAC are stored in instance storage
    test_env.env.as_contract(&test_env.contract_id, || {
        let stored_admin: Address = test_env
            .env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        let stored_usdc: Address = test_env
            .env
            .storage()
            .instance()
            .get(&DataKey::UsdcSac)
            .unwrap();
        assert_eq!(stored_admin, test_env.admin);
        assert_eq!(stored_usdc, test_env.usdc_sac);
    });
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_init_twice_panics() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
}

// ── 2. Deposit Tests ─────────────────────────────────────────────────────────

#[test]
fn test_deposit_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);

    // Mint 1000 USDC to user first
    test_env.token_admin_client.mint(&user, &1000);
    assert_eq!(test_env.token_client.balance(&user), 1000);

    // Deposit 400 USDC
    test_env.client.deposit(&user, &400);

    // Verify USDC transfers
    assert_eq!(test_env.token_client.balance(&user), 600);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify UserAccount balance increases
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.balance, 400);
    assert_eq!(account.total_deposited, 400);
    assert_eq!(test_env.client.get_balance(&user), 400);
}

#[test]
#[should_panic(expected = "Deposit must be positive")]
fn test_deposit_zero_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.client.deposit(&user, &0);
}

#[test]
#[should_panic(expected = "Deposit must be positive")]
fn test_deposit_negative_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.client.deposit(&user, &-50);
}

// ── 3. Withdraw Tests ────────────────────────────────────────────────────────

#[test]
fn test_withdraw_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &600);

    // Withdraw 200 USDC
    test_env.client.withdraw(&user, &200);

    // Verify USDC is returned to user
    assert_eq!(test_env.token_client.balance(&user), 600); // 400 leftover + 200 returned
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify balance reduces
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.balance, 400);
}

#[test]
#[should_panic(expected = "Withdrawal must be positive")]
fn test_withdraw_zero_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &600);
    test_env.client.withdraw(&user, &0);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn test_withdraw_insufficient_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &600);
    test_env.client.withdraw(&user, &601);
}

#[test]
#[should_panic(expected = "Cannot withdraw while tasks are active")]
fn test_withdraw_blocked_active_task() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &600);

    // Register orchestrator
    let name = soroban_sdk::String::from_str(&test_env.env, "TestOrch");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Create a task to set active_tasks_count = 1
    test_env.client.create_task(&orchestrator, &100);

    // Attempt to withdraw
    test_env.client.withdraw(&user, &50);
}

#[test]
#[should_panic(expected = "Withdrawal must be positive")]
fn test_withdraw_negative_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &600);
    test_env.client.withdraw(&user, &-10);
}

// ── 4. Register Orchestrator Tests ───────────────────────────────────────────

#[test]
fn test_register_orchestrator_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Verify stored
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.orchestrator.unwrap(), orchestrator);
    assert_eq!(account.orchestrator_name, name);

    // Verify reverse lookup
    assert_eq!(
        test_env
            .client
            .get_orchestrator_owner(&orchestrator)
            .unwrap(),
        user
    );
}

#[test]
#[should_panic(expected = "Orchestrator already registered for this user")]
fn test_register_orchestrator_twice_panics() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator1 = Address::generate(&test_env.env);
    let orchestrator2 = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env
        .client
        .register_orchestrator(&user, &orchestrator1, &name);
    // Call second time
    test_env
        .client
        .register_orchestrator(&user, &orchestrator2, &name);
}

// ── 5. Create Task Tests ─────────────────────────────────────────────────────

#[test]
fn test_create_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    let task_id = test_env.client.create_task(&orchestrator, &300);
    assert_eq!(task_id, 1);
    assert_eq!(test_env.client.task_count(), 1);

    // Verify account locked increases and active_tasks_count becomes 1
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.locked, 300);
    assert_eq!(account.active_tasks_count, 1);
    assert_eq!(test_env.client.get_available(&user), 200);

    // Verify task details
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.user, user);
    assert_eq!(task.orchestrator, orchestrator);
    assert_eq!(task.plan_cost, 300);
    assert_eq!(task.spent, 0);
    assert!(!task.completed);
}

#[test]
#[should_panic(expected = "User already has an active task")]
fn test_create_task_already_active_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.client.create_task(&orchestrator, &100);
    // Second task while the first is active
    test_env.client.create_task(&orchestrator, &100);
}

#[test]
#[should_panic(expected = "Insufficient available balance")]
fn test_create_task_insufficient_available_balance_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Plan cost (600) exceeds deposited (500)
    test_env.client.create_task(&orchestrator, &600);
}

#[test]
#[should_panic(expected = "Plan cost must be positive")]
fn test_create_task_zero_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    test_env.client.create_task(&orchestrator, &0);
}

#[test]
#[should_panic(expected = "Plan cost must be positive")]
fn test_create_task_negative_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    test_env.client.create_task(&orchestrator, &-10);
}

// ── 6. Release Payment Tests ─────────────────────────────────────────────────

#[test]
fn test_release_payment_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Release 100 USDC payment
    let success = test_env
        .client
        .release_payment(&orchestrator, &task_id, &100);
    assert!(success);

    // Verify USDC transfers to orchestrator
    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify task.spent increases
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.spent, 100);

    // Release another 200 USDC (exact remaining plan_cost)
    let success2 = test_env
        .client
        .release_payment(&orchestrator, &task_id, &200);
    assert!(success2);
    assert_eq!(test_env.token_client.balance(&orchestrator), 300);

    let task2 = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task2.spent, 300);
}

#[test]
#[should_panic(expected = "Exceeds plan cost")]
fn test_release_payment_exceeds_plan_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &301);
}

#[test]
#[should_panic(expected = "Task already completed")]
fn test_release_payment_on_completed_task_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &100);
    test_env.client.complete_task(&orchestrator, &task_id);

    // Try releasing on completed task
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &50);
}

#[test]
#[should_panic(expected = "Not authorized for this task")]
fn test_release_payment_unauthorized_orchestrator_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let wrong_orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Call release_payment with wrong orchestrator
    test_env
        .client
        .release_payment(&wrong_orchestrator, &task_id, &100);
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn test_release_payment_zero_amount_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Call release_payment with 0 amount
    test_env.client.release_payment(&orchestrator, &task_id, &0);
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn test_release_payment_negative_amount_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Call release_payment with negative amount
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &-50);
}

// ── 7. Complete Task Tests ───────────────────────────────────────────────────

#[test]
fn test_complete_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &100);

    // Complete the task
    test_env.client.complete_task(&orchestrator, &task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    // Verify account locked is reduced and unused budget remains in account balance
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 400);
    assert_eq!(account.total_spent, 100);
    assert_eq!(account.active_tasks_count, 0);
    assert_eq!(test_env.client.get_available(&user), 400);
}

#[test]
#[should_panic(expected = "Not authorized")]
fn test_complete_task_unauthorized_orchestrator_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let wrong_orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Call complete_task with wrong orchestrator
    test_env.client.complete_task(&wrong_orchestrator, &task_id);
}

// ── 8. Cancel Task Tests ─────────────────────────────────────────────────────

#[test]
fn test_cancel_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &100);

    // User cancels their own task
    test_env.client.cancel_task(&user, &task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 400);
    assert_eq!(account.active_tasks_count, 0);
}

#[test]
#[should_panic(expected = "Not your task")]
fn test_cancel_task_wrong_user_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let wrong_user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Another user tries to cancel
    test_env.client.cancel_task(&wrong_user, &task_id);
}

// ── 9. Force Complete Stale Task Tests ───────────────────────────────────────

#[test]
#[should_panic(expected = "Task is not stale yet")]
fn test_force_complete_stale_task_fails_before_threshold() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.env.ledger().set_timestamp(1000);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Advance timestamp by 1799 seconds (under 30 minutes)
    test_env.env.ledger().set_timestamp(1000 + 1799);

    // Attempt to force complete should fail
    test_env.client.force_complete_stale_task(&task_id);
}

#[test]
fn test_force_complete_stale_task_succeeds_after_threshold() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.env.ledger().set_timestamp(1000);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    // Advance timestamp by 1801 seconds (over 30 minutes)
    test_env.env.ledger().set_timestamp(1000 + 1801);

    // Attempt to force complete should succeed
    test_env.client.force_complete_stale_task(&task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 500); // 0 spent
    assert_eq!(account.active_tasks_count, 0);
}
