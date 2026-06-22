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
// ── TTL Extension Tests ─────────────────────────────────────────────────

#[test]
fn test_user_account_survives_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);

    // Deposit creates the UserAccount entry and (per the fix) extends its TTL
    // to PERSISTENT_TTL_EXTEND_TO (~30 days / 518_400 ledgers) from the
    // current ledger.
    test_env.client.deposit(&user, &400);

    // Sanity check: account is readable immediately after deposit.
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.balance, 400);

    // Advance the ledger sequence number well past the TTL extension
    // threshold (17_280, ~1 day) but still within the extended TTL window
    // (518_400, ~30 days) that the deposit call should have set. Before the
    // extend_ttl fix, this contract made zero extend_ttl calls, so a
    // persistent entry's TTL would simply be whatever the default test
    // environment TTL is â€” this test would fail without the fix if that
    // default is below the sequence number we advance to.
    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 300_000);

    // The account must still be reachable: this is the core regression this
    // issue describes â€” a UserAccount silently becoming inaccessible after
    // a period of inactivity because its TTL was never extended.
    let account_after_advance = test_env.client.get_account(&user).unwrap();
    assert_eq!(account_after_advance.balance, 400);
    assert_eq!(account_after_advance.total_deposited, 400);

    // get_balance and get_available, which also touch DataKey::User, must
    // likewise still succeed and return correct values.
    assert_eq!(test_env.client.get_balance(&user), 400);
    assert_eq!(test_env.client.get_available(&user), 400);
}

#[test]
fn test_task_and_orchestrator_owner_entries_survive_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);
    test_env.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&test_env.env, "test-orch"),
    );

    let task_id = test_env.client.create_task(&orchestrator, &200);

    // Advance the ledger sequence number well past the TTL extension
    // threshold, simulating a long period of inactivity on this task and
    // on the orchestrator's reverse-lookup entry.
    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 300_000);

    // DataKey::Task(task_id) must still be reachable.
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.plan_cost, 200);
    assert!(!task.completed);

    // DataKey::OrchestratorOwner(orchestrator) must still be reachable â€”
    // exercised indirectly via create_task's internal lookup, and directly
    // via the public getter here.
    let owner = test_env
        .client
        .get_orchestrator_owner(&orchestrator)
        .unwrap();
    assert_eq!(owner, user);

    // Instance storage (TaskCounter, read via task_count) must also have
    // survived the same ledger advance, since instance entries share one
    // TTL that must be bumped on any call that reads them.
    assert_eq!(test_env.client.task_count(), 1);
}

#[test]
fn test_instance_storage_survives_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // Advance the ledger sequence number well past the TTL extension
    // threshold immediately after init, with no further contract
    // interaction in between, to specifically exercise instance storage
    // (Admin, UsdcSac, TaskCounter) rather than any persistent entry.
    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 300_000);

    // A deposit call reads UsdcSac from instance storage internally; if
    // instance TTL had expired, this would fail. This also implicitly
    // confirms init's extend_instance_ttl call set a long enough TTL.
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &100);

    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.balance, 100);

    // task_count reads TaskCounter directly from instance storage.
    assert_eq!(test_env.client.task_count(), 0);
}

// ── 10. Pause / Unpause Tests ───────────────────────────────────────────────

#[test]
fn test_is_paused_default_false() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    assert!(!test_env.client.is_paused());
}

#[test]
fn test_pause_sets_flag() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    test_env.client.pause(&test_env.admin);
    assert!(test_env.client.is_paused());
}

#[test]
fn test_unpause_clears_flag() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    test_env.client.pause(&test_env.admin);
    assert!(test_env.client.is_paused());
    test_env.client.unpause(&test_env.admin);
    assert!(!test_env.client.is_paused());
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_deposit_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);

    test_env.client.pause(&test_env.admin);
    test_env.client.deposit(&user, &100);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_create_task_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.client.pause(&test_env.admin);
    test_env.client.create_task(&orchestrator, &300);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_release_payment_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env.client.pause(&test_env.admin);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &100);
}

#[test]
fn test_withdraw_and_cancel_work_while_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env.client.create_task(&orchestrator, &300);

    test_env.client.pause(&test_env.admin);

    // Cancel task should work while paused
    test_env.client.cancel_task(&user, &task_id);
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    // Withdraw should work while paused
    test_env.client.withdraw(&user, &500);
    assert_eq!(test_env.token_client.balance(&user), 1000);
    let account = test_env.client.get_account(&user).unwrap();
    assert_eq!(account.balance, 0);
}

#[test]
fn test_unpause_restores_deposit() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);

    test_env.client.pause(&test_env.admin);
    test_env.client.unpause(&test_env.admin);

    // Deposit should succeed after unpausing
    test_env.client.deposit(&user, &100);
    assert_eq!(test_env.token_client.balance(&user), 900);
}

#[test]
#[should_panic(expected = "admin must match stored admin")]
fn test_unauthorized_pause_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let non_admin = Address::generate(&test_env.env);

    test_env.client.pause(&non_admin);
}

#[test]
#[should_panic(expected = "admin must match stored admin")]
fn test_unauthorized_unpause_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let non_admin = Address::generate(&test_env.env);

    test_env.client.unpause(&non_admin);
}
