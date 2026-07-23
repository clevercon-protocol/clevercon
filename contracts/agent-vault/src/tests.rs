use crate::{AgentVault, AgentVaultClient, DataKey, VaultError};
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
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

fn create_task_history(test_env: &TestEnv, task_count: u32) -> Address {
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &100);
    test_env.client.deposit(&user, &test_env.usdc_sac, &100);
    test_env.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&test_env.env, "history-orchestrator"),
    );

    for index in 0..task_count {
        let task_id =
            test_env
                .client
                .create_task(&orchestrator, &test_env.usdc_sac, &i128::from(index + 1));
        test_env.client.complete_task(&orchestrator, &task_id);
    }

    user
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
    // After #39, an active task no longer blocks withdrawal outright — only the
    // portion locked by the task for that asset is protected.
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

    // Lock 100 in an active task → 500 of the 600 stays unlocked.
    test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &100);

    // The unlocked portion is withdrawable even though a task is active...
    test_env.client.withdraw(&user, &test_env.usdc_sac, &500);
    assert_eq!(test_env.client.get_balance(&user, &test_env.usdc_sac), 100);

    // ...but the locked remainder cannot be withdrawn.
    let result = test_env.client.try_withdraw(&user, &test_env.usdc_sac, &1);
    assert!(result == Err(Ok(VaultError::InsufficientAvailable)));
}

#[test]
fn test_withdraw_other_asset_while_task_active() {
    // The headline case from #39: a task locking asset A must not block the
    // withdrawal of an entirely separate asset B.
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // Whitelist a second asset (e.g. XLM) and wire up its token clients.
    let asset_b_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone());
    let asset_b = asset_b_sac.address();
    test_env.client.add_asset(&test_env.admin, &asset_b);
    let asset_b_admin = token::StellarAssetClient::new(&test_env.env, &asset_b);
    let asset_b_token = token::Client::new(&test_env.env, &asset_b);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "TestOrch");

    // Deposit USDC and lock ALL of it in an active task.
    test_env.token_admin_client.mint(&user, &600);
    test_env.client.deposit(&user, &test_env.usdc_sac, &600);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &600);

    // Deposit asset B — unrelated to the task.
    asset_b_admin.mint(&user, &500);
    test_env.client.deposit(&user, &asset_b, &500);

    // Asset B is fully withdrawable even though USDC is entirely locked.
    test_env.client.withdraw(&user, &asset_b, &500);
    assert_eq!(asset_b_token.balance(&user), 500);
    assert_eq!(test_env.client.get_balance(&user, &asset_b), 0);

    // The locked USDC, however, stays put.
    let result = test_env.client.try_withdraw(&user, &test_env.usdc_sac, &1);
    assert!(result == Err(Ok(VaultError::InsufficientAvailable)));
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

#[test]
fn test_update_orchestrator_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let old_orchestrator = Address::generate(&test_env.env);
    let new_orchestrator = Address::generate(&test_env.env);
    let old_name = soroban_sdk::String::from_str(&test_env.env, "OldOrchestrator");
    let new_name = soroban_sdk::String::from_str(&test_env.env, "NewOrchestrator");

    test_env
        .client
        .register_orchestrator(&user, &old_orchestrator, &old_name);

    test_env
        .client
        .update_orchestrator(&user, &new_orchestrator, &new_name);

    let config = test_env.client.get_user_config(&user).unwrap();
    assert_eq!(config.orchestrator, Some(new_orchestrator.clone()));
    assert_eq!(config.orchestrator_name, new_name);

    assert!(test_env
        .client
        .get_orchestrator_owner(&old_orchestrator)
        .is_none());
    assert_eq!(
        test_env.client.get_orchestrator_owner(&new_orchestrator),
        Some(user)
    );
}

#[test]
fn test_update_orchestrator_blocked_when_task_active() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let old_orchestrator = Address::generate(&test_env.env);
    let new_orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "MyOrchestrator");
    let new_name = soroban_sdk::String::from_str(&test_env.env, "NextOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &old_orchestrator, &name);
    test_env
        .client
        .create_task(&old_orchestrator, &test_env.usdc_sac, &100);

    let result = test_env
        .client
        .try_update_orchestrator(&user, &new_orchestrator, &new_name);
    assert!(result == Err(Ok(VaultError::ActiveTaskExists)));
}

#[test]
fn test_update_orchestrator_rejects_address_owned_by_another_user() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user1 = Address::generate(&test_env.env);
    let user2 = Address::generate(&test_env.env);
    let orchestrator1 = Address::generate(&test_env.env);
    let shared_orchestrator = Address::generate(&test_env.env);
    let name1 = soroban_sdk::String::from_str(&test_env.env, "User1Orchestrator");
    let name2 = soroban_sdk::String::from_str(&test_env.env, "User2Orchestrator");
    let takeover_name = soroban_sdk::String::from_str(&test_env.env, "TakeoverAttempt");

    test_env
        .client
        .register_orchestrator(&user1, &orchestrator1, &name1);
    test_env
        .client
        .register_orchestrator(&user2, &shared_orchestrator, &name2);

    let result =
        test_env
            .client
            .try_update_orchestrator(&user1, &shared_orchestrator, &takeover_name);
    assert!(result == Err(Ok(VaultError::OrchestratorAlreadyRegistered)));

    let user1_config = test_env.client.get_user_config(&user1).unwrap();
    assert_eq!(user1_config.orchestrator, Some(orchestrator1.clone()));
    assert_eq!(user1_config.orchestrator_name, name1);
    assert_eq!(
        test_env.client.get_orchestrator_owner(&orchestrator1),
        Some(user1)
    );
    assert_eq!(
        test_env.client.get_orchestrator_owner(&shared_orchestrator),
        Some(user2)
    );
}

#[test]
fn test_update_orchestrator_fails_when_none_registered() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let new_orchestrator = Address::generate(&test_env.env);
    let new_name = soroban_sdk::String::from_str(&test_env.env, "NewOrchestrator");

    let result = test_env
        .client
        .try_update_orchestrator(&user, &new_orchestrator, &new_name);
    assert!(result == Err(Ok(VaultError::OrchestratorNotRegistered)));
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
fn test_create_task_allows_multiple_concurrent_tasks_when_balance_is_sufficient() {
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

    let first_task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &100);
    let second_task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &150);

    assert_eq!(first_task_id, 1);
    assert_eq!(second_task_id, 2);
    assert_eq!(test_env.client.task_count(), 2);

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 250);
    assert_eq!(account.active_tasks_count, 2);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        250
    );
}

#[test]
fn test_create_second_task_insufficient_available_balance_fails() {
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
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    // Only 200 remains available, so a second task costing 250 must fail.
    let result = test_env
        .client
        .try_create_task(&orchestrator, &test_env.usdc_sac, &250);
    assert!(result == Err(Ok(VaultError::InsufficientAvailable)));

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 300);
    assert_eq!(account.active_tasks_count, 1);
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
fn test_two_concurrent_tasks_complete_independently() {
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

    let first_task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &100);
    let second_task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &150);

    test_env
        .client
        .release_payment(&orchestrator, &first_task_id, &test_env.usdc_sac, &60);
    test_env
        .client
        .release_payment(&orchestrator, &second_task_id, &test_env.usdc_sac, &90);

    test_env.client.complete_task(&orchestrator, &first_task_id);

    let mid_account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(mid_account.locked, 150);
    assert_eq!(mid_account.balance, 440);
    assert_eq!(mid_account.total_spent, 60);
    assert_eq!(mid_account.active_tasks_count, 1);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        290
    );
    assert!(test_env.client.get_task(&first_task_id).unwrap().completed);
    assert!(!test_env.client.get_task(&second_task_id).unwrap().completed);

    test_env
        .client
        .complete_task(&orchestrator, &second_task_id);

    let final_account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(final_account.locked, 0);
    assert_eq!(final_account.balance, 350);
    assert_eq!(final_account.total_spent, 150);
    assert_eq!(final_account.active_tasks_count, 0);
    assert_eq!(
        test_env.client.get_available(&user, &test_env.usdc_sac),
        350
    );
    assert!(test_env.client.get_task(&second_task_id).unwrap().completed);
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
fn test_pause_emits_pause_event() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    test_env.client.pause(&test_env.admin);

    let events = test_env.env.events().all();
    assert_eq!(events.events().len(), 1);
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
fn test_unpause_emits_unpause_event() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    test_env.client.pause(&test_env.admin);
    test_env.client.unpause(&test_env.admin);

    let events = test_env.env.events().all();
    assert_eq!(events.events().len(), 1);
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

#[test]
fn test_get_user_task_infos_empty() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = Address::generate(&t.env);

    assert_eq!(t.client.get_user_task_infos(&user, &0, &10).len(), 0);
}

#[test]
fn test_get_user_task_infos_full_page_in_creation_order() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = create_task_history(&t, 5);

    let tasks = t.client.get_user_task_infos(&user, &1, &3);

    assert_eq!(tasks.len(), 3);
    assert_eq!(tasks.get(0).unwrap().plan_cost, 2);
    assert_eq!(tasks.get(1).unwrap().plan_cost, 3);
    assert_eq!(tasks.get(2).unwrap().plan_cost, 4);
}

#[test]
fn test_get_user_task_infos_partial_last_page() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = create_task_history(&t, 5);

    let tasks = t.client.get_user_task_infos(&user, &3, &4);

    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks.get(0).unwrap().plan_cost, 4);
    assert_eq!(tasks.get(1).unwrap().plan_cost, 5);
}

#[test]
fn test_get_user_task_infos_out_of_range_start() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = create_task_history(&t, 3);

    assert_eq!(t.client.get_user_task_infos(&user, &u32::MAX, &10).len(), 0);
}

#[test]
fn test_get_user_task_infos_caps_limit() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let user = create_task_history(&t, 55);

    let tasks = t.client.get_user_task_infos(&user, &0, &u32::MAX);

    assert_eq!(tasks.len(), 50);
    assert_eq!(tasks.get(0).unwrap().plan_cost, 1);
    assert_eq!(tasks.get(49).unwrap().plan_cost, 50);
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

// 12. Max Active Tasks Tests

#[test]
fn test_get_max_active_tasks_default() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    assert_eq!(t.client.get_max_active_tasks(), 50);
}

#[test]
fn test_set_max_active_tasks_success() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    t.client.set_max_active_tasks(&t.admin, &5);
    assert_eq!(t.client.get_max_active_tasks(), 5);
}

#[test]
fn test_set_max_active_tasks_unauthorized_fails() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let non_admin = Address::generate(&t.env);

    let result = t.client.try_set_max_active_tasks(&non_admin, &5);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_max_active_tasks_rejects_zero() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    let result = t.client.try_set_max_active_tasks(&t.admin, &0);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_task_fails_when_cap_reached() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    t.client.set_max_active_tasks(&t.admin, &2);

    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    let name = soroban_sdk::String::from_str(&t.env, "MyOrchestrator");

    t.token_admin_client.mint(&user, &1000);
    t.client.deposit(&user, &t.usdc_sac, &900);
    t.client.register_orchestrator(&user, &orchestrator, &name);

    t.client.create_task(&orchestrator, &t.usdc_sac, &100);
    t.client.create_task(&orchestrator, &t.usdc_sac, &100);

    let result = t.client.try_create_task(&orchestrator, &t.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::TooManyActiveTasks)));

    let config = t.client.get_user_config(&user).unwrap();
    assert_eq!(config.active_tasks_count, 2);
}

#[test]
fn test_completing_task_frees_slot_for_new_task() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    t.client.set_max_active_tasks(&t.admin, &1);

    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    let name = soroban_sdk::String::from_str(&t.env, "MyOrchestrator");

    t.token_admin_client.mint(&user, &1000);
    t.client.deposit(&user, &t.usdc_sac, &900);
    t.client.register_orchestrator(&user, &orchestrator, &name);

    let task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &100);

    let result = t.client.try_create_task(&orchestrator, &t.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::TooManyActiveTasks)));

    t.client.complete_task(&orchestrator, &task_id);

    // Slot freed, new task creation now succeeds.
    let second_task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &100);
    assert_eq!(second_task_id, 2);
}

#[test]
fn test_lowering_cap_below_current_count_does_not_affect_existing_tasks() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    let user = Address::generate(&t.env);
    let orchestrator = Address::generate(&t.env);
    let name = soroban_sdk::String::from_str(&t.env, "MyOrchestrator");

    t.token_admin_client.mint(&user, &1000);
    t.client.deposit(&user, &t.usdc_sac, &900);
    t.client.register_orchestrator(&user, &orchestrator, &name);

    let first_task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &100);
    let second_task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &100);

    // Lower the cap below the user's current active count (2).
    t.client.set_max_active_tasks(&t.admin, &1);

    // Existing tasks are untouched and can still be finalized.
    t.client.complete_task(&orchestrator, &first_task_id);
    let task = t.client.get_task(&first_task_id).unwrap();
    assert!(task.completed);

    // New task creation stays blocked until the count drops under the new cap.
    let result = t.client.try_create_task(&orchestrator, &t.usdc_sac, &100);
    assert!(result == Err(Ok(VaultError::TooManyActiveTasks)));

    t.client.complete_task(&orchestrator, &second_task_id);
    let third_task_id = t.client.create_task(&orchestrator, &t.usdc_sac, &100);
    assert_eq!(third_task_id, 3);
}

// ── Admin key rotation tests ─────────────────────────────────────────────────

/// Positive: admin rotates to new_admin successfully.
#[test]
fn test_update_admin_succeeds() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let new_admin = Address::generate(&t.env);

    t.client.update_admin(&t.admin, &new_admin);

    // get_admin must return new_admin
    let stored = t.client.get_admin();
    assert_eq!(stored, new_admin);
}

/// After rotation, the old admin can no longer pause the contract.
#[test]
fn test_old_admin_cannot_pause_after_rotation() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let new_admin = Address::generate(&t.env);

    t.client.update_admin(&t.admin, &new_admin);

    // Old admin tries to pause — must fail
    let result = t.client.try_pause(&t.admin);
    assert!(result.is_err());
}

/// After rotation, the new admin can pause the contract.
#[test]
fn test_new_admin_can_pause_after_rotation() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let new_admin = Address::generate(&t.env);

    t.client.update_admin(&t.admin, &new_admin);
    t.client.pause(&new_admin);
    // If we get here without panic, new admin successfully paused
}

/// Negative: non-admin caller cannot rotate the admin key.
#[test]
#[should_panic]
fn test_non_admin_cannot_update_admin() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let attacker = Address::generate(&t.env);
    let new_admin = Address::generate(&t.env);

    // attacker is not the stored admin — must panic
    t.client.update_admin(&attacker, &new_admin);
}

/// get_admin returns the current admin without requiring auth.
#[test]
fn test_get_admin_returns_current_admin() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    let stored = t.client.get_admin();
    assert_eq!(stored, t.admin);
}

/// UpdateAdminEvent is emitted on successful admin rotation.
#[test]
fn test_update_admin_emits_event() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let new_admin = Address::generate(&t.env);

    t.client.update_admin(&t.admin, &new_admin);

    let events = t.env.events().all();
    assert_eq!(events.events().len(), 1);
}

/// Chained rotation: new admin can rotate again.
#[test]
fn test_chained_admin_rotation() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let second_admin = Address::generate(&t.env);
    let third_admin = Address::generate(&t.env);

    t.client.update_admin(&t.admin, &second_admin);
    t.client.update_admin(&second_admin, &third_admin);

    let stored = t.client.get_admin();
    assert_eq!(stored, third_admin);
}

mod invariant_tests {
    extern crate std;
    use super::*;

    trait IsOkOk {
        #[allow(clippy::wrong_self_convention)]
        fn is_ok_ok(self) -> bool;
    }

    impl<T, E1, E2> IsOkOk for Result<Result<T, E1>, E2> {
        #[allow(clippy::wrong_self_convention)]
        fn is_ok_ok(self) -> bool {
            matches!(self, Ok(Ok(_)))
        }
    }

    struct SimpleRng {
        state: u64,
    }

    impl SimpleRng {
        fn new(seed: u64) -> Self {
            Self { state: seed }
        }

        fn next(&mut self) -> u64 {
            self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
            self.state
        }

        fn next_range(&mut self, min: u64, max: u64) -> u64 {
            if min >= max {
                return min;
            }
            let range = max - min + 1;
            min + (self.next() % range)
        }
    }

    struct TaskState {
        id: u64,
        user_idx: usize,
        orchestrator_idx: usize,
        asset_idx: usize,
    }

    struct InvariantTestHarness {
        env: Env,
        client: AgentVaultClient<'static>,
        usdc_sac: Address,
        xlm_sac: Address,
        token_admins: [token::StellarAssetClient<'static>; 2],
        users: [Address; 2],
        orchestrators: [Address; 2],
        active_tasks: std::vec::Vec<TaskState>,
        last_total_spent: [[i128; 2]; 2],
    }

    fn setup_harness() -> InvariantTestHarness {
        let test_env = setup_test();
        test_env.client.init(&test_env.admin, &test_env.usdc_sac);

        let xlm_sac_contract = test_env
            .env
            .register_stellar_asset_contract_v2(test_env.admin.clone());
        let xlm_sac = xlm_sac_contract.address();
        test_env.client.add_asset(&test_env.admin, &xlm_sac);

        let xlm_admin = token::StellarAssetClient::new(&test_env.env, &xlm_sac);
        let token_admins = [test_env.token_admin_client, xlm_admin];

        let user_a = Address::generate(&test_env.env);
        let user_b = Address::generate(&test_env.env);
        let users = [user_a, user_b];

        let orch_a = Address::generate(&test_env.env);
        let orch_b = Address::generate(&test_env.env);
        let orchestrators = [orch_a, orch_b];

        let name_a = soroban_sdk::String::from_str(&test_env.env, "OrchA");
        let name_b = soroban_sdk::String::from_str(&test_env.env, "OrchB");
        test_env
            .client
            .register_orchestrator(&users[0], &orchestrators[0], &name_a);
        test_env
            .client
            .register_orchestrator(&users[1], &orchestrators[1], &name_b);

        InvariantTestHarness {
            env: test_env.env,
            client: test_env.client,
            usdc_sac: test_env.usdc_sac,
            xlm_sac,
            token_admins,
            users,
            orchestrators,
            active_tasks: std::vec::Vec::new(),
            last_total_spent: [[0; 2]; 2],
        }
    }

    impl InvariantTestHarness {
        fn assert_invariants(&mut self, seed: u64, step_idx: usize) {
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            for (u_idx, user) in self.users.iter().enumerate() {
                for (a_idx, asset) in assets.iter().enumerate() {
                    if let Some(account) = self.client.get_account(user, asset) {
                        assert!(
                            0 <= account.locked,
                            "Seed {}, Step {}: locked balance underflow (locked = {})",
                            seed,
                            step_idx,
                            account.locked
                        );
                        assert!(
                            account.locked <= account.balance,
                            "Seed {}, Step {}: locked > balance (locked = {}, balance = {})",
                            seed,
                            step_idx,
                            account.locked,
                            account.balance
                        );
                        assert!(
                            account.balance >= 0,
                            "Seed {}, Step {}: balance negative (balance = {})",
                            seed,
                            step_idx,
                            account.balance
                        );

                        let prev_spent = self.last_total_spent[u_idx][a_idx];
                        assert!(
                            account.total_spent >= prev_spent,
                            "Seed {}, Step {}: total_spent decreased from {} to {}",
                            seed,
                            step_idx,
                            prev_spent,
                            account.total_spent
                        );
                        self.last_total_spent[u_idx][a_idx] = account.total_spent;
                    }
                }
            }
        }

        fn finalize_and_check<F, R>(
            &mut self,
            task_idx: usize,
            seed: u64,
            step_idx: usize,
            finalize_op: F,
        ) where
            F: FnOnce(&mut Self, u64) -> R,
            R: IsOkOk,
        {
            if task_idx >= self.active_tasks.len() {
                return;
            }
            let task_state = &self.active_tasks[task_idx];
            let task_id = task_state.id;
            let user_idx = task_state.user_idx;
            let asset_idx = task_state.asset_idx;

            let user = self.users[user_idx].clone();
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = assets[asset_idx].clone();

            let task_before = self.client.get_task(&task_id).unwrap();
            let account_before = self.client.get_account(&user, &asset).unwrap();

            let res = finalize_op(self, task_id);

            if res.is_ok_ok() {
                let task_after = self.client.get_task(&task_id).unwrap();
                let account_after = self.client.get_account(&user, &asset).unwrap();

                assert!(
                    task_after.completed,
                    "Seed {}, Step {}: finalized task not marked completed",
                    seed, step_idx
                );

                let locked_diff = account_before.locked - account_after.locked;
                assert_eq!(
                    locked_diff, task_before.plan_cost,
                    "Seed {}, Step {}: locked did not decrease by plan_cost: expected {}, got {}",
                    seed, step_idx, task_before.plan_cost, locked_diff
                );

                let balance_diff = account_before.balance - account_after.balance;
                assert_eq!(
                    balance_diff, task_before.spent,
                    "Seed {}, Step {}: balance did not decrease by spent: expected {}, got {}",
                    seed, step_idx, task_before.spent, balance_diff
                );

                let spent_diff = account_after.total_spent - account_before.total_spent;
                assert_eq!(
                    spent_diff, task_before.spent,
                    "Seed {}, Step {}: total_spent did not increase by spent: expected {}, got {}",
                    seed, step_idx, task_before.spent, spent_diff
                );

                assert!(
                    0 <= task_before.spent && task_before.spent <= task_before.plan_cost,
                    "Seed {}, Step {}: spent out of bounds: spent = {}, plan_cost = {}",
                    seed,
                    step_idx,
                    task_before.spent,
                    task_before.plan_cost
                );

                self.active_tasks.remove(task_idx);
            }
        }

        fn deposit(&mut self, user_idx: usize, asset_idx: usize, amount: i128) {
            let user = &self.users[user_idx];
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = &assets[asset_idx];

            self.token_admins[asset_idx].mint(user, &amount);
            let _ = self.client.try_deposit(user, asset, &amount);
        }

        fn withdraw(&mut self, user_idx: usize, asset_idx: usize, amount: i128) {
            let user = &self.users[user_idx];
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = &assets[asset_idx];

            let _ = self.client.try_withdraw(user, asset, &amount);
        }

        fn create_task(&mut self, orch_idx: usize, asset_idx: usize, plan_cost: i128) {
            let orchestrator = &self.orchestrators[orch_idx];
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = &assets[asset_idx];

            let res = self.client.try_create_task(orchestrator, asset, &plan_cost);

            if let Ok(Ok(task_id)) = res {
                self.active_tasks.push(TaskState {
                    id: task_id,
                    user_idx: orch_idx,
                    orchestrator_idx: orch_idx,
                    asset_idx,
                });
            }
        }

        fn release_payment(&mut self, task_idx: usize, amount: i128) {
            if task_idx >= self.active_tasks.len() {
                return;
            }
            let task_state = &self.active_tasks[task_idx];
            let task_id = task_state.id;
            let orchestrator = &self.orchestrators[task_state.orchestrator_idx];
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = &assets[task_state.asset_idx];

            let _ = self
                .client
                .try_release_payment(orchestrator, &task_id, asset, &amount);
        }

        fn complete_task(&mut self, task_idx: usize, seed: u64, step_idx: usize) {
            if task_idx >= self.active_tasks.len() {
                return;
            }
            let orchestrator =
                self.orchestrators[self.active_tasks[task_idx].orchestrator_idx].clone();
            self.finalize_and_check(task_idx, seed, step_idx, move |harness, task_id| {
                harness.client.try_complete_task(&orchestrator, &task_id)
            });
        }

        fn cancel_task(&mut self, task_idx: usize, seed: u64, step_idx: usize) {
            if task_idx >= self.active_tasks.len() {
                return;
            }
            let user = self.users[self.active_tasks[task_idx].user_idx].clone();
            self.finalize_and_check(task_idx, seed, step_idx, move |harness, task_id| {
                harness.client.try_cancel_task(&user, &task_id)
            });
        }

        fn force_complete_stale_task(
            &mut self,
            task_idx: usize,
            time_advance: u64,
            seed: u64,
            step_idx: usize,
        ) {
            if time_advance > 0 {
                let current = self.env.ledger().timestamp();
                self.env.ledger().set_timestamp(current + time_advance);
            }
            self.finalize_and_check(task_idx, seed, step_idx, |harness, task_id| {
                harness.client.try_force_complete_stale_task(&task_id)
            });
        }
    }

    #[test]
    fn test_vault_accounting_invariants() {
        for seed in 1..=30 {
            let mut harness = setup_harness();
            let mut rng = SimpleRng::new(seed);

            for step_idx in 0..100 {
                let op = rng.next_range(0, 6);
                match op {
                    0 => {
                        let user_idx = rng.next_range(0, 1) as usize;
                        let asset_idx = rng.next_range(0, 1) as usize;
                        let amount = rng.next_range(1, 10000) as i128;
                        harness.deposit(user_idx, asset_idx, amount);
                    }
                    1 => {
                        let user_idx = rng.next_range(0, 1) as usize;
                        let asset_idx = rng.next_range(0, 1) as usize;
                        let amount = rng.next_range(1, 12000) as i128;
                        harness.withdraw(user_idx, asset_idx, amount);
                    }
                    2 => {
                        let orch_idx = rng.next_range(0, 1) as usize;
                        let asset_idx = rng.next_range(0, 1) as usize;
                        let plan_cost = rng.next_range(1, 5000) as i128;
                        harness.create_task(orch_idx, asset_idx, plan_cost);
                    }
                    3 => {
                        if !harness.active_tasks.is_empty() {
                            let task_idx =
                                rng.next_range(0, (harness.active_tasks.len() - 1) as u64) as usize;
                            let amount = rng.next_range(1, 6000) as i128;
                            harness.release_payment(task_idx, amount);
                        }
                    }
                    4 => {
                        if !harness.active_tasks.is_empty() {
                            let task_idx =
                                rng.next_range(0, (harness.active_tasks.len() - 1) as u64) as usize;
                            harness.complete_task(task_idx, seed, step_idx);
                        }
                    }
                    5 => {
                        if !harness.active_tasks.is_empty() {
                            let task_idx =
                                rng.next_range(0, (harness.active_tasks.len() - 1) as u64) as usize;
                            harness.cancel_task(task_idx, seed, step_idx);
                        }
                    }
                    6 => {
                        if !harness.active_tasks.is_empty() {
                            let task_idx =
                                rng.next_range(0, (harness.active_tasks.len() - 1) as u64) as usize;
                            let time_advance = rng.next_range(0, 2400);
                            harness.force_complete_stale_task(
                                task_idx,
                                time_advance,
                                seed,
                                step_idx,
                            );
                        }
                    }
                    _ => unreachable!(),
                }

                harness.assert_invariants(seed, step_idx);
            }
        }
    }

    #[test]
    fn test_explicit_partial_release_and_completion_math() {
        let mut harness = setup_harness();
        harness.deposit(0, 0, 1000);
        harness.assert_invariants(999, 0);

        harness.create_task(0, 0, 600);
        harness.assert_invariants(999, 1);
        assert_eq!(harness.active_tasks.len(), 1);

        harness.release_payment(0, 200);
        harness.assert_invariants(999, 2);

        harness.complete_task(0, 999, 3);
        harness.assert_invariants(999, 4);
        assert_eq!(harness.active_tasks.len(), 0);

        let account = harness
            .client
            .get_account(&harness.users[0], &harness.usdc_sac)
            .unwrap();
        assert_eq!(account.balance, 800);
        assert_eq!(account.locked, 0);
        assert_eq!(account.total_spent, 200);
    }
}
