use crate::{AgentVault, AgentVaultClient, DataKey, VaultError};
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

// 1. Init Tests

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

    // Check USDC is supported automatically
    assert!(test_env.client.is_supported_asset(&test_env.usdc_sac));
}

#[test]
fn test_init_twice_panics() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let result = test_env
        .client
        .try_init(&test_env.admin, &test_env.usdc_sac);
    assert!(result == Err(Ok(VaultError::AlreadyInitialized)));
}

// 2. Deposit Tests

#[test]
fn test_deposit_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);

    // Mint 1000 USDC to user first
    test_env.token_admin_client.mint(&user, &1000);
    assert_eq!(test_env.token_client.balance(&user), 1000);

    // Deposit 400 USDC
    test_env.client.deposit(&user, &test_env.usdc_sac, &400);

    // Verify USDC transfers
    assert_eq!(test_env.token_client.balance(&user), 600);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify UserAccount balance increases
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.balance, 400);
    assert_eq!(account.total_deposited, 400);
    assert_eq!(test_env.client.get_balance(&user, &test_env.usdc_sac), 400);

    // deposit persists UserConfig (required for withdraw); orchestrator stays unset
    let config = test_env.client.get_user_config(&user).unwrap();
    assert!(config.orchestrator.is_none());
    assert_eq!(config.active_tasks_count, 0);
}

#[test]
fn test_deposit_zero_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let result = test_env.client.try_deposit(&user, &test_env.usdc_sac, &0);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_deposit_negative_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let result = test_env.client.try_deposit(&user, &test_env.usdc_sac, &-50);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

// 3. Withdraw Tests

#[test]
fn test_withdraw_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);

    // Withdraw 200 USDC
    test_env.client.withdraw(&user, &test_env.usdc_sac, &200);

    // Verify USDC is returned to user
    assert_eq!(test_env.token_client.balance(&user), 600); // 400 leftover + 200 returned
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify balance reduces
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.balance, 400);
}

#[test]
fn test_withdraw_zero_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);
    let result = test_env.client.try_withdraw(&user, &test_env.usdc_sac, &0);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_withdraw_insufficient_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);
    let result = test_env
        .client
        .try_withdraw(&user, &test_env.usdc_sac, &601);
    assert!(result == Err(Ok(VaultError::InsufficientBalance)));
}

#[test]
fn test_withdraw_blocked_active_task() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "TestOrch");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);

    // Register orchestrator
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Create a task to set active_tasks_count = 1
    test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &100);

    // Attempt to withdraw
    let result = test_env.client.try_withdraw(&user, &test_env.usdc_sac, &50);
    assert!(result == Err(Ok(VaultError::ActiveTaskExists)));
}

#[test]
fn test_withdraw_negative_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);
    let result = test_env
        .client
        .try_withdraw(&user, &test_env.usdc_sac, &-10);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

// 4. Register Orchestrator Tests

#[test]
fn test_get_user_config_before_and_after_register() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    assert!(test_env.client.get_user_config(&user).is_none());

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    let config = test_env.client.get_user_config(&user).unwrap();
    assert_eq!(config.orchestrator.unwrap(), orchestrator);
    assert_eq!(config.orchestrator_name, name);
    assert_eq!(config.active_tasks_count, 0);
}

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
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
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
    let result = test_env
        .client
        .try_register_orchestrator(&user, &orchestrator2, &name);
    assert!(result == Err(Ok(VaultError::OrchestratorAlreadyRegistered)));
}

// 5. Create Task Tests

#[test]
fn test_create_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);
    assert_eq!(task_id, 1);
    assert_eq!(test_env.client.task_count(), 1);

    // Verify account locked increases and active_tasks_count becomes 1
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 300);
    assert_eq!(account.active_tasks_count, 1);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        200
    );

    // Verify task details
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.user, user);
    assert_eq!(task.orchestrator, orchestrator);
    assert_eq!(task.asset, test_env.usdc_sac);
    assert_eq!(task.plan_cost, 300);
    assert_eq!(task.spent, 0);
    assert!(!task.completed);
}

#[test]
fn test_create_task_already_active_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &100);
    // Second task while the first is active
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::ActiveTaskExists)));
}

#[test]
fn test_create_task_insufficient_available_balance_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Plan cost (600) exceeds deposited (500)
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &600);
    assert!(result == Err(Ok(VaultError::InsufficientAvailable)));
}

#[test]
fn test_create_task_zero_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &0);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_task_negative_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &-10);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

// 6. Release Payment Tests

#[test]
fn test_release_payment_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Release 100 USDC payment
    let success =
        test_env
            .client
            .release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &100);
    assert!(success);

    // Verify USDC transfers to orchestrator
    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);

    // Verify task.spent increases
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.spent, 100);

    // Release another 200 USDC (exact remaining plan_cost)
    let success2 =
        test_env
            .client
            .release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &200);
    assert!(success2);
    assert_eq!(test_env.token_client.balance(&orchestrator), 300);

    let task2 = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task2.spent, 300);
}

#[test]
fn test_release_payment_exceeds_plan_cost_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &301);
    assert!(result == Err(Ok(VaultError::ExceedsPlanCost)));
}

#[test]
fn test_release_payment_on_completed_task_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &100);
    test_env.client.complete_task(&orchestrator, &task_id);

    // Try releasing on completed task
    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &50);
    assert!(result == Err(Ok(VaultError::TaskAlreadyCompleted)));
}

#[test]
fn test_release_payment_unauthorized_orchestrator_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let wrong_orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Call release_payment with wrong orchestrator
    let result = test_env.client.try_release_payment(
        &wrong_orchestrator,
        &task_id,
        &test_env.usdc_sac,
        &100,
    );
    assert!(result == Err(Ok(VaultError::NotYourOrchestrator)));
}

#[test]
fn test_release_payment_zero_amount_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Call release_payment with 0 amount
    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &0);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_release_payment_negative_amount_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Call release_payment with negative amount
    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &-50);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

// 7. Complete Task Tests

#[test]
fn test_complete_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &100);

    // Complete the task
    test_env.client.complete_task(&orchestrator, &task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    // Verify account locked is reduced and unused budget remains in account balance
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 400);
    assert_eq!(account.total_spent, 100);
    assert_eq!(account.active_tasks_count, 0);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        400
    );
}

#[test]
fn test_complete_task_unauthorized_orchestrator_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let wrong_orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Call complete_task with wrong orchestrator
    let result = test_env
        .client
        .try_complete_task(&wrong_orchestrator, &task_id);
    assert!(result == Err(Ok(VaultError::NotYourOrchestrator)));
}

// 8. Cancel Task Tests

#[test]
fn test_cancel_task_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &100);

    // User cancels their own task
    test_env.client.cancel_task(&user, &task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 400);
    assert_eq!(account.active_tasks_count, 0);
}

#[test]
fn test_cancel_task_wrong_user_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let wrong_user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Another user tries to cancel
    let result = test_env.client.try_cancel_task(&wrong_user, &task_id);
    assert!(result == Err(Ok(VaultError::NotYourTask)));
}

// 9. Force Complete Stale Task Tests

#[test]
fn test_force_complete_stale_task_fails_before_threshold() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.env.ledger().set_timestamp(1000);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Advance timestamp by 1799 seconds (under 30 minutes)
    test_env.env.ledger().set_timestamp(1000 + 1799);

    // Attempt to force complete should fail
    let result = test_env.client.try_force_complete_stale_task(&task_id);
    assert!(result == Err(Ok(VaultError::TaskNotStale)));
}

#[test]
fn test_force_complete_stale_task_succeeds_after_threshold() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);

    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.env.ledger().set_timestamp(1000);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Advance timestamp by 1801 seconds (over 30 minutes)
    test_env.env.ledger().set_timestamp(1000 + 1801);

    // Attempt to force complete should succeed
    test_env.client.force_complete_stale_task(&task_id);

    // Verify task is completed
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 500); // 0 spent
    assert_eq!(account.active_tasks_count, 0);
}

// TTL Extension Tests

#[test]
fn test_user_account_survives_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);

    test_env.client.deposit(&user, &test_env.usdc_sac, &400);

    // Sanity check: account is readable immediately after deposit.
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.balance, 400);

    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 300_000);

    let account_after_advance = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account_after_advance.balance, 400);
    assert_eq!(account_after_advance.total_deposited, 400);

    assert_eq!(test_env.client.get_balance(&user, &test_env.usdc_sac), 400);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        400
    );
}

#[test]
fn test_task_and_orchestrator_owner_entries_survive_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&test_env.env, "test-orch"),
    );

    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &200);

    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 300_000);

    // DataKey::Task(task_id) must still be reachable.
    let task = test_env.client.get_task(&task_id).unwrap();
    assert_eq!(task.plan_cost, 200);
    assert!(!task.completed);

    let owner = test_env
        .client
        .get_orchestrator_owner(&orchestrator)
        .unwrap();
    assert_eq!(owner, user);

    assert_eq!(test_env.client.task_count(), 1);
}

#[test]
fn test_instance_storage_survives_ttl_after_extension() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // init extends instance TTL to ledger + 518_400. Advance until remaining TTL
    // is below the 17_280 extension threshold so deposit must refresh instance storage.
    let starting_sequence = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(starting_sequence + 501_121);

    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &100);

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.balance, 100);

    // Instance storage must remain readable after deposit refreshes instance TTL.
    assert_eq!(test_env.client.task_count(), 0);
    assert!(!test_env.client.is_paused());
}

// Multi-Asset Whitelist & Flow Tests

#[test]
fn test_multi_asset_whitelist() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();

    // Not supported initially
    assert!(!test_env.client.is_supported_asset(&xlm_sac));

    // Admin adds the asset
    test_env.client.add_asset(&test_env.admin, &xlm_sac);
    assert!(test_env.client.is_supported_asset(&xlm_sac));

    // Admin removes the asset
    test_env
        .client
        .remove_asset(&test_env.admin, &xlm_sac, &true);
    assert!(!test_env.client.is_supported_asset(&xlm_sac));
}

#[test]
#[should_panic(expected = "Pass force=true to confirm removal of a live asset")]
fn test_remove_asset_requires_force() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();

    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    // Attempting to remove without force=true should panic
    test_env
        .client
        .remove_asset(&test_env.admin, &xlm_sac, &false);
}

#[test]
fn test_deposit_non_whitelisted_asset_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();

    // Attempt deposit of unwhitelisted token
    let result = test_env.client.try_deposit(&user, &xlm_sac, &200);
    assert!(result == Err(Ok(VaultError::AssetNotSupported)));
}

#[test]
fn test_multi_asset_deposit_withdraw_task_flow() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    // Setup XLM token client
    let xlm_client = token::Client::new(&test_env.env, &xlm_sac);
    let xlm_admin = token::StellarAssetClient::new(&test_env.env, &xlm_sac);

    // Mint USDC and XLM to user
    test_env.token_admin_client.mint(&user, &1000);
    xlm_admin.mint(&user, &2000);

    // Deposit both
    test_env.client.deposit(&user, &test_env.usdc_sac, &400);
    test_env.client.deposit(&user, &xlm_sac, &800);

    // Check balances
    assert_eq!(test_env.client.get_balance(&user, &test_env.usdc_sac), 400);
    assert_eq!(test_env.client.get_balance(&user, &xlm_sac), 800);

    // Create a task in XLM
    let task_id = test_env.client.create_task(&orchestrator, &xlm_sac, &500);

    // Check locked/available in both assets
    let usdc_account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(usdc_account.balance, 400);
    assert_eq!(usdc_account.locked, 0);

    let xlm_account = test_env.client.get_account(&user, &xlm_sac).unwrap();
    assert_eq!(xlm_account.balance, 800);
    assert_eq!(xlm_account.locked, 500);
    assert_eq!(xlm_account.active_tasks_count, 1);

    // Release payment in XLM
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &xlm_sac, &200);

    assert_eq!(xlm_client.balance(&orchestrator), 200);
    assert_eq!(test_env.token_client.balance(&orchestrator), 0); // No USDC transferred

    // Complete task
    test_env.client.complete_task(&orchestrator, &task_id);

    let xlm_account_final = test_env.client.get_account(&user, &xlm_sac).unwrap();
    assert_eq!(xlm_account_final.balance, 600); // 800 - 200 spent
    assert_eq!(xlm_account_final.locked, 0);
    assert_eq!(xlm_account_final.active_tasks_count, 0);

    // Withdraw remaining XLM
    test_env.client.withdraw(&user, &xlm_sac, &600);
    assert_eq!(xlm_client.balance(&user), 1800); // 2000 initial - 800 deposit + 600 withdraw
}

// 10. Pause / Unpause Tests

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
fn test_deposit_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &1000);

    test_env.client.pause(&test_env.admin);
    let result = test_env.client.try_deposit(&user, &test_env.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::ContractPaused)));
}

#[test]
fn test_create_task_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.client.pause(&test_env.admin);
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &300);
    assert!(result == Err(Ok(VaultError::ContractPaused)));
}

#[test]
fn test_release_payment_reverts_when_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    test_env.client.pause(&test_env.admin);
    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &test_env.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::ContractPaused)));
}

#[test]
fn test_withdraw_and_cancel_work_while_paused() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    test_env.client.pause(&test_env.admin);

    // Cancel task should work while paused
    test_env.client.cancel_task(&user, &task_id);
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);

    // Withdraw should work while paused
    test_env.client.withdraw(&user, &test_env.usdc_sac, &500);
    assert_eq!(test_env.token_client.balance(&user), 1000);
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
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
    test_env.client.deposit(&user, &test_env.usdc_sac, &100);
    assert_eq!(test_env.token_client.balance(&user), 900);
}

#[test]
fn test_unauthorized_pause_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let non_admin = Address::generate(&test_env.env);

    let result = test_env.client.try_pause(&non_admin);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_unauthorized_unpause_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let non_admin = Address::generate(&test_env.env);

    let result = test_env.client.try_unpause(&non_admin);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_get_user_tasks_empty() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = Address::generate(&t.env);
    let result = t.client.get_user_tasks(&user);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_user_tasks_single() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    t.token_admin_client.mint(&user, &10_000_000_000_i128);
    t.client.deposit(&user, &t.usdc_sac, &10_000_000_000_i128);
    t.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&t.env, "orch1"),
    );
    let id = t
        .client
        .create_task(&orchestrator, &t.usdc_sac, &1_000_000_000_i128);
    let tasks = t.client.get_user_tasks(&user);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks.get(0).unwrap(), id);
}

#[test]
fn test_get_user_tasks_multiple_in_order() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    t.token_admin_client.mint(&user, &30_000_000_000_i128);
    t.client.deposit(&user, &t.usdc_sac, &30_000_000_000_i128);
    t.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&t.env, "orch1"),
    );
    let id1 = t
        .client
        .create_task(&orchestrator, &t.usdc_sac, &1_000_000_000_i128);
    t.client.complete_task(&orchestrator, &id1);
    let id2 = t
        .client
        .create_task(&orchestrator, &t.usdc_sac, &1_000_000_000_i128);
    t.client.complete_task(&orchestrator, &id2);
    let tasks = t.client.get_user_tasks(&user);
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks.get(0).unwrap(), id1);
    assert_eq!(tasks.get(1).unwrap(), id2);
}

#[test]
fn test_get_user_tasks_separate_users() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    t.token_admin_client.mint(&user1, &10_000_000_000_i128);
    t.client.deposit(&user1, &t.usdc_sac, &10_000_000_000_i128);
    t.client.register_orchestrator(
        &user1,
        &orchestrator,
        &soroban_sdk::String::from_str(&t.env, "orch1"),
    );
    t.client
        .create_task(&orchestrator, &t.usdc_sac, &1_000_000_000_i128);
    assert_eq!(t.client.get_user_tasks(&user2).len(), 0);
    assert_eq!(t.client.get_user_tasks(&user1).len(), 1);
}

// 11. Stale Task Threshold Tests

#[test]
fn test_get_stale_threshold_default() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    assert_eq!(t.client.get_stale_threshold(), 1800);
}

#[test]
fn test_set_stale_threshold_success() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    t.client.set_stale_threshold(&t.admin, &3600);
    assert_eq!(t.client.get_stale_threshold(), 3600);
}

#[test]
fn test_set_stale_threshold_unauthorized_fails() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let non_admin = Address::generate(&t.env);

    let result = t.client.try_set_stale_threshold(&non_admin, &3600);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_stale_threshold_enforces_minimum() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    let result = t.client.try_set_stale_threshold(&t.admin, &59);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_force_complete_respects_updated_threshold() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    let name = soroban_sdk::String::from_str(&t.env, "MyOrchestrator");

    t.token_admin_client.mint(&user, &1000);
    t.client.deposit(&user, &t.usdc_sac, &500);
    t.client.register_orchestrator(&user, &orchestrator, &name);

    // Set threshold to 1 hour (3600s)
    t.client.set_stale_threshold(&t.admin, &3600);

    t.env.ledger().set_timestamp(1000);
    let task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &300);

    // Advance 31 minutes (1860s) - would be stale under old 1800s default
    t.env.ledger().set_timestamp(1000 + 1860);

    // Attempt to force complete should fail now
    let result = t.client.try_force_complete_stale_task(&task_id);
    assert!(result == Err(Ok(VaultError::TaskNotStale)));

    // Advance to 61 minutes (3660s)
    t.env.ledger().set_timestamp(1000 + 3660);

    // Now it should succeed
    t.client.force_complete_stale_task(&task_id);
    let task = t.client.get_task(&task_id).unwrap();
    assert!(task.completed);
}
