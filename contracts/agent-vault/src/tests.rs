mod malicious_token;
mod mock_verifier;

use crate::{AgentVault, AgentVaultClient, DataKey, TaskStatus, VaultError};
use malicious_token::{MaliciousToken, MaliciousTokenClient, ReentryAction, ReentryConfig};
use mock_verifier::{MockVerifier, MockVerifierClient, VerifyMode};
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
use soroban_sdk::{token, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val};

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

fn create_status_test_task(test_env: &TestEnv, created_at: u64) -> (Address, Address, u64) {
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "status-orchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);

    test_env.env.ledger().set_timestamp(created_at);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    (user, orchestrator, task_id)
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
            .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
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
            .release_payment(&orchestrator, &task_id, &2, &test_env.usdc_sac, &200);
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
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &301);
    assert!(result == Err(Ok(VaultError::ExceedsPlanCost)));
}

#[test]
fn test_release_payment_replay_is_idempotent_success() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "ReplayOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    assert!(test_env.client.release_payment(
        &orchestrator,
        &task_id,
        &42,
        &test_env.usdc_sac,
        &100
    ));
    assert!(test_env.client.release_payment(
        &orchestrator,
        &task_id,
        &42,
        &test_env.usdc_sac,
        &100
    ));

    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 400);
    assert_eq!(test_env.client.get_task(&task_id).unwrap().spent, 100);
}

#[test]
fn test_release_payment_same_step_different_amount_conflicts() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "ConflictOrchestrator");

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
        .release_payment(&orchestrator, &task_id, &7, &test_env.usdc_sac, &100);

    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &7, &test_env.usdc_sac, &101);

    assert!(result == Err(Ok(VaultError::ReleaseConflict)));
    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
    assert_eq!(test_env.client.get_task(&task_id).unwrap().spent, 100);
}

#[test]
fn test_release_payment_distinct_steps_same_amount_accumulate() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "DistinctStepsOrchestrator");

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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &2, &test_env.usdc_sac, &100);

    assert_eq!(test_env.token_client.balance(&orchestrator), 200);
    assert_eq!(test_env.client.get_task(&task_id).unwrap().spent, 200);
}

#[test]
fn test_release_payment_step_records_are_bounded_per_task() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "BoundedStepsOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    for step_id in 1..=256 {
        assert!(test_env.client.release_payment(
            &orchestrator,
            &task_id,
            &step_id,
            &test_env.usdc_sac,
            &1
        ));
    }

    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &257, &test_env.usdc_sac, &1);

    assert!(result == Err(Ok(VaultError::TooManyStepReleases)));
    assert_eq!(test_env.client.get_task(&task_id).unwrap().spent, 256);
}

#[test]
fn test_release_payment_replay_after_completion_rejects_cleanly() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "CompletedReplayOrchestrator");

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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
    test_env.client.complete_task(&orchestrator, &task_id);

    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

    assert!(result == Err(Ok(VaultError::TaskAlreadyCompleted)));
    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
}

#[test]
fn test_release_payment_replay_after_force_complete_rejects_cleanly() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    test_env.env.ledger().set_timestamp(1000);
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "StaleReplayOrchestrator");

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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
    test_env.env.ledger().set_timestamp(2801);
    test_env.client.force_complete_stale_task(&task_id);

    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

    assert!(result == Err(Ok(VaultError::TaskAlreadyCompleted)));
    assert_eq!(test_env.token_client.balance(&orchestrator), 100);
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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
    test_env.client.complete_task(&orchestrator, &task_id);

    // Try releasing on completed task
    let result =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &2, &test_env.usdc_sac, &50);
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
        &1,
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
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &0);
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
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &-50);
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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

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
        .release_payment(&orchestrator, &first_task_id, &1, &test_env.usdc_sac, &60);
    test_env
        .client
        .release_payment(&orchestrator, &second_task_id, &1, &test_env.usdc_sac, &90);

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
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

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

// Supported-assets enumeration (get_supported_assets)

/// Convenience: does the enumerable index currently contain `asset`?
fn index_contains(assets: &soroban_sdk::Vec<Address>, asset: &Address) -> bool {
    assets.iter().any(|a| a == *asset)
}

#[test]
fn test_get_supported_assets_seeded_with_usdc_on_init() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let assets = test_env.client.get_supported_assets();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets.get(0).unwrap(), test_env.usdc_sac);
    // The index and is_supported_asset() must agree.
    assert!(test_env.client.is_supported_asset(&test_env.usdc_sac));
}

#[test]
fn test_get_supported_assets_appends_on_add() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    let assets = test_env.client.get_supported_assets();
    assert_eq!(assets.len(), 2);
    assert!(index_contains(&assets, &test_env.usdc_sac));
    assert!(index_contains(&assets, &xlm_sac));
    assert!(test_env.client.is_supported_asset(&xlm_sac));
}

#[test]
fn test_get_supported_assets_add_is_idempotent() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();

    // Adding the same asset twice must not create a duplicate entry.
    test_env.client.add_asset(&test_env.admin, &xlm_sac);
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    let assets = test_env.client.get_supported_assets();
    assert_eq!(assets.len(), 2);
    assert!(index_contains(&assets, &xlm_sac));

    // Re-adding the auto-seeded USDC is likewise a no-op on the index.
    test_env
        .client
        .add_asset(&test_env.admin, &test_env.usdc_sac);
    assert_eq!(test_env.client.get_supported_assets().len(), 2);
}

#[test]
fn test_get_supported_assets_removes_on_remove() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);
    assert_eq!(test_env.client.get_supported_assets().len(), 2);

    // Removing XLM leaves only USDC in the index, and the two views agree.
    test_env
        .client
        .remove_asset(&test_env.admin, &xlm_sac, &true);

    let assets = test_env.client.get_supported_assets();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets.get(0).unwrap(), test_env.usdc_sac);
    assert!(!index_contains(&assets, &xlm_sac));
    assert!(!test_env.client.is_supported_asset(&xlm_sac));
    assert!(test_env.client.is_supported_asset(&test_env.usdc_sac));
}

#[test]
fn test_get_supported_assets_empty_after_removing_all() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    // Remove both the added asset and the auto-seeded USDC.
    test_env
        .client
        .remove_asset(&test_env.admin, &xlm_sac, &true);
    test_env
        .client
        .remove_asset(&test_env.admin, &test_env.usdc_sac, &true);

    assert_eq!(test_env.client.get_supported_assets().len(), 0);
    assert!(!test_env.client.is_supported_asset(&test_env.usdc_sac));
    assert!(!test_env.client.is_supported_asset(&xlm_sac));
}

#[test]
fn test_remove_nonexistent_asset_leaves_index_unchanged() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // An asset that was never whitelisted — removal is a harmless no-op.
    let never_added = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env
        .client
        .remove_asset(&test_env.admin, &never_added, &true);

    let assets = test_env.client.get_supported_assets();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets.get(0).unwrap(), test_env.usdc_sac);
}

// The contract extends a persistent entry's TTL back up to ~518_400 ledgers
// only once its remaining TTL drops below ~17_280. Advancing just past that
// extension point lets a test observe whether a given call refreshed a
// particular key: a still-low TTL afterwards means it was NOT refreshed.
const TTL_EXTEND_THRESHOLD: u32 = 17_280;
const TTL_DECAY_STEP: u32 = 510_000;

/// Reads the remaining persistent TTL of `key`, in ledgers, from inside the
/// contract's storage context.
fn persistent_ttl(test_env: &TestEnv, key: &DataKey) -> u32 {
    test_env.env.as_contract(&test_env.contract_id, || {
        test_env.env.storage().persistent().get_ttl(key)
    })
}

fn persistent_has(test_env: &TestEnv, key: &DataKey) -> bool {
    test_env.env.as_contract(&test_env.contract_id, || {
        test_env.env.storage().persistent().has(key)
    })
}

#[test]
fn test_step_release_records_refresh_ttl_and_are_removed_on_finalize() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "TtlOrchestrator");

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
        .release_payment(&orchestrator, &task_id, &99, &test_env.usdc_sac, &100);

    let record_key = DataKey::TaskStepRelease(task_id, 99);
    let ids_key = DataKey::TaskStepIds(task_id);
    assert!(persistent_has(&test_env, &record_key));
    assert!(persistent_has(&test_env, &ids_key));

    let start = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(start + TTL_DECAY_STEP);
    assert!(persistent_ttl(&test_env, &record_key) < TTL_EXTEND_THRESHOLD);
    assert!(persistent_ttl(&test_env, &ids_key) < TTL_EXTEND_THRESHOLD);

    assert!(test_env.client.release_payment(
        &orchestrator,
        &task_id,
        &99,
        &test_env.usdc_sac,
        &100
    ));
    assert!(persistent_ttl(&test_env, &record_key) > TTL_EXTEND_THRESHOLD);
    assert!(persistent_ttl(&test_env, &ids_key) > TTL_EXTEND_THRESHOLD);

    test_env.client.complete_task(&orchestrator, &task_id);
    assert!(!persistent_has(&test_env, &record_key));
    assert!(!persistent_has(&test_env, &ids_key));
}

#[test]
fn test_is_supported_asset_refreshes_index_ttl() {
    // Direction 1: per-asset lookups (as deposit/create_task perform) must keep
    // the SupportedAssets index on the same TTL lifecycle. Otherwise the index
    // expires first and get_supported_assets silently loses assets that
    // is_supported_asset still reports as supported.
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    // Advance until the index's TTL has decayed below the extension threshold.
    let start = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(start + TTL_DECAY_STEP);
    assert!(
        persistent_ttl(&test_env, &DataKey::SupportedAssets) < TTL_EXTEND_THRESHOLD,
        "precondition: index TTL should have decayed below the extension threshold"
    );

    // A per-asset lookup must refresh the index lifecycle as well.
    assert!(test_env.client.is_supported_asset(&xlm_sac));

    assert!(
        persistent_ttl(&test_env, &DataKey::SupportedAssets) > TTL_EXTEND_THRESHOLD,
        "is_supported_asset must extend the SupportedAssets index TTL, not just the per-asset flag"
    );
}

#[test]
fn test_get_supported_assets_refreshes_per_asset_flag_ttl() {
    // Direction 2: enumerating the whitelist must keep each per-asset flag on the
    // same TTL lifecycle. Otherwise the flags expire first and is_supported_asset
    // disagrees with the index the enumeration just returned.
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let xlm_sac = test_env
        .env
        .register_stellar_asset_contract_v2(test_env.admin.clone())
        .address();
    test_env.client.add_asset(&test_env.admin, &xlm_sac);

    let start = test_env.env.ledger().sequence();
    test_env
        .env
        .ledger()
        .set_sequence_number(start + TTL_DECAY_STEP);
    let flag_key = DataKey::AssetSupported(xlm_sac.clone());
    assert!(
        persistent_ttl(&test_env, &flag_key) < TTL_EXTEND_THRESHOLD,
        "precondition: per-asset flag TTL should have decayed below the extension threshold"
    );

    // Enumerating must refresh each per-asset flag lifecycle as well.
    let _ = test_env.client.get_supported_assets();

    assert!(
        persistent_ttl(&test_env, &flag_key) > TTL_EXTEND_THRESHOLD,
        "get_supported_assets must extend each per-asset AssetSupported flag TTL, not just the index"
    );
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
        .release_payment(&orchestrator, &task_id, &1, &xlm_sac, &200);

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
            .try_release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);
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
fn test_get_task_status_returns_none_for_unknown_task() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);

    assert_eq!(t.client.get_task_status(&999), None);
}

#[test]
fn test_get_task_status_matches_force_complete_boundary() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let (_, _, task_id) = create_status_test_task(&t, 1000);

    t.env.ledger().set_timestamp(1000 + 1800);
    assert_eq!(t.client.get_task_status(&task_id), Some(TaskStatus::Active));
    let result = t.client.try_force_complete_stale_task(&task_id);
    assert!(result == Err(Ok(VaultError::TaskNotStale)));

    t.env.ledger().set_timestamp(1000 + 1801);
    assert_eq!(t.client.get_task_status(&task_id), Some(TaskStatus::Stale));

    t.client.force_complete_stale_task(&task_id);
    assert_eq!(
        t.client.get_task_status(&task_id),
        Some(TaskStatus::Completed)
    );
}

#[test]
fn test_get_task_status_completed_wins_after_threshold() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let (_, orchestrator, task_id) = create_status_test_task(&t, 1000);

    t.client.complete_task(&orchestrator, &task_id);
    t.env.ledger().set_timestamp(1000 + 1801);

    assert_eq!(
        t.client.get_task_status(&task_id),
        Some(TaskStatus::Completed)
    );
}

#[test]
fn test_get_task_status_cancelled_task_is_completed() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let (user, _, task_id) = create_status_test_task(&t, 1000);

    t.client.cancel_task(&user, &task_id);

    assert_eq!(
        t.client.get_task_status(&task_id),
        Some(TaskStatus::Completed)
    );
}

#[test]
fn test_get_task_status_uses_threshold_changed_after_creation() {
    let t = setup_test();
    t.client.init(&t.admin, &t.usdc_sac);
    let (_, _, task_id) = create_status_test_task(&t, 1000);

    t.client.set_stale_threshold(&t.admin, &3600);

    t.env.ledger().set_timestamp(1000 + 1801);
    assert_eq!(t.client.get_task_status(&task_id), Some(TaskStatus::Active));

    t.env.ledger().set_timestamp(1000 + 3600);
    assert_eq!(t.client.get_task_status(&task_id), Some(TaskStatus::Active));

    t.env.ledger().set_timestamp(1000 + 3601);
    assert_eq!(t.client.get_task_status(&task_id), Some(TaskStatus::Stale));
}

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
        next_step_id: u64,
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
                    next_step_id: 1,
                });
            }
        }

        fn release_payment(&mut self, task_idx: usize, amount: i128) {
            if task_idx >= self.active_tasks.len() {
                return;
            }
            let task_state = &mut self.active_tasks[task_idx];
            let task_id = task_state.id;
            let step_id = task_state.next_step_id;
            task_state.next_step_id += 1;
            let orchestrator = &self.orchestrators[task_state.orchestrator_idx];
            let assets = [self.usdc_sac.clone(), self.xlm_sac.clone()];
            let asset = &assets[task_state.asset_idx];

            let _ =
                self.client
                    .try_release_payment(orchestrator, &task_id, &step_id, asset, &amount);
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

    #[test]
    fn test_token_balance_multiple_deposits() {
        let test_env = setup_test();
        test_env.client.init(&test_env.admin, &test_env.usdc_sac);

        let user1 = Address::generate(&test_env.env);
        let user2 = Address::generate(&test_env.env);

        test_env.token_admin_client.mint(&user1, &1000);
        test_env.token_admin_client.mint(&user2, &2000);

        test_env.client.deposit(&user1, &test_env.usdc_sac, &400);
        test_env.client.deposit(&user2, &test_env.usdc_sac, &600);

        let bal1 = test_env.client.get_balance(&user1, &test_env.usdc_sac);
        let bal2 = test_env.client.get_balance(&user2, &test_env.usdc_sac);

        let contract_bal = test_env.client.token_balance(&test_env.usdc_sac);

        assert_eq!(contract_bal, bal1 + bal2);
        assert_eq!(contract_bal, 1000);
    }

    #[test]
    fn test_token_balance_withdraw_reduction() {
        let test_env = setup_test();
        test_env.client.init(&test_env.admin, &test_env.usdc_sac);

        let user = Address::generate(&test_env.env);
        test_env.token_admin_client.mint(&user, &1000);
        test_env.client.deposit(&user, &test_env.usdc_sac, &600);

        let balance_before = test_env.client.token_balance(&test_env.usdc_sac);
        assert_eq!(balance_before, 600);

        test_env.client.withdraw(&user, &test_env.usdc_sac, &200);

        let balance_after = test_env.client.token_balance(&test_env.usdc_sac);
        assert_eq!(balance_after, 400);
        assert_eq!(balance_before - balance_after, 200);
    }

    #[test]
    fn test_token_balance_partial_spend() {
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

        let initial_balance = test_env.client.token_balance(&test_env.usdc_sac);
        assert_eq!(initial_balance, 500);

        // Create a task with plan_cost 300
        let task_id = test_env
            .client
            .create_task(&orchestrator, &test_env.usdc_sac, &300);

        // Token balance is unchanged
        assert_eq!(test_env.client.token_balance(&test_env.usdc_sac), 500);

        // Release step payment of 100
        test_env
            .client
            .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

        // Token balance drops by 100
        assert_eq!(test_env.client.token_balance(&test_env.usdc_sac), 400);

        // Complete task with partial spend (100 spent)
        test_env.client.complete_task(&orchestrator, &task_id);

        // Token balance remains at 400 (drops by exactly spent (100), not plan_cost (300))
        let final_balance = test_env.client.token_balance(&test_env.usdc_sac);
        assert_eq!(final_balance, 400);
        assert_eq!(initial_balance - final_balance, 100);
    }
}

#[test]
fn test_version_returns_contract_version() {
    let test_env = setup_test();
    // Bumped to 6 by #122: TaskInfo gained `policy_commitment` and new
    // policy/nullifier storage keys were added.
    assert_eq!(test_env.client.version(), 6);
}

// 13. Dispute & Arbitration Tests

/// Sets up a user with 500 deposited USDC, a registered orchestrator, the given
/// dispute resolver, and a 300-cost active task. Returns (user, orchestrator, task_id).
fn setup_dispute_task(test_env: &TestEnv, resolver: Address) -> (Address, Address, u64) {
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "DisputeOrchestrator");

    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    test_env
        .client
        .set_dispute_resolver(&test_env.admin, &resolver);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);

    (user, orchestrator, task_id)
}

#[test]
fn test_set_and_get_dispute_resolver() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    assert!(test_env.client.get_dispute_resolver().is_none());

    let resolver = Address::generate(&test_env.env);
    test_env
        .client
        .set_dispute_resolver(&test_env.admin, &resolver);
    assert_eq!(
        test_env.client.get_dispute_resolver(),
        Some(resolver.clone())
    );

    // The admin may update the resolver at any time.
    let new_resolver = Address::generate(&test_env.env);
    test_env
        .client
        .set_dispute_resolver(&test_env.admin, &new_resolver);
    assert_eq!(test_env.client.get_dispute_resolver(), Some(new_resolver));
}

#[test]
fn test_set_dispute_resolver_unauthorized_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let non_admin = Address::generate(&test_env.env);
    let resolver = Address::generate(&test_env.env);

    let result = test_env
        .client
        .try_set_dispute_resolver(&non_admin, &resolver);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_dispute_happy_path_split() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    // Orchestrator already released 100 of the 300 plan cost.
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &100);

    // User raises the dispute: it freezes releases and completion.
    test_env.client.raise_dispute(&user, &task_id);
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.disputed);
    assert!(!task.completed);
    assert_eq!(
        test_env.client.get_task_status(&task_id),
        Some(TaskStatus::Disputed)
    );

    let rel =
        test_env
            .client
            .try_release_payment(&orchestrator, &task_id, &2, &test_env.usdc_sac, &50);
    assert!(rel == Err(Ok(VaultError::TaskDisputed)));
    let cmp = test_env.client.try_complete_task(&orchestrator, &task_id);
    assert!(cmp == Err(Ok(VaultError::TaskDisputed)));

    // Resolver settles the 200 still-locked remainder as an 80/120 split.
    test_env
        .client
        .resolve_dispute(&resolver, &task_id, &80, &120);

    // Tokens: 100 already released + 120 payout to orchestrator, 80 refund to
    // user. Contract keeps 500 - 100 - 80 - 120 = 200.
    assert_eq!(test_env.token_client.balance(&user), 580); // 1000 minted - 500 deposited + 80 refund
    assert_eq!(test_env.token_client.balance(&orchestrator), 220); // 100 released + 120 payout
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 200);

    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);
    assert_eq!(
        test_env.client.get_task_status(&task_id),
        Some(TaskStatus::Completed)
    );

    // Accounting invariants after resolution: 0 <= locked <= balance.
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 200); // 500 - plan_cost(300)
    assert_eq!(account.total_spent, 220); // released 100 + payout 120
    assert_eq!(account.active_tasks_count, 0);
}

#[test]
fn test_resolve_dispute_non_resolver_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver);
    test_env.client.raise_dispute(&user, &task_id);

    let impostor = Address::generate(&test_env.env);
    let result = test_env
        .client
        .try_resolve_dispute(&impostor, &task_id, &300, &0);
    assert!(result == Err(Ok(VaultError::NotDisputeResolver)));

    // Still disputed and unresolved.
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.disputed);
    assert!(!task.completed);
}

#[test]
fn test_resolve_dispute_without_resolver_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // No dispute resolver is configured at all.
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    let name = soroban_sdk::String::from_str(&test_env.env, "Orch");
    test_env.token_admin_client.mint(&user, &1000);
    test_env.client.deposit(&user, &test_env.usdc_sac, &500);
    test_env
        .client
        .register_orchestrator(&user, &orchestrator, &name);
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &300);
    test_env.client.raise_dispute(&user, &task_id);

    let anyone = Address::generate(&test_env.env);
    let result = test_env
        .client
        .try_resolve_dispute(&anyone, &task_id, &300, &0);
    assert!(result == Err(Ok(VaultError::DisputeResolverNotSet)));
}

#[test]
fn test_raise_dispute_non_user_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (_user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver);

    let attacker = Address::generate(&test_env.env);
    let result = test_env.client.try_raise_dispute(&attacker, &task_id);
    assert!(result == Err(Ok(VaultError::NotYourTask)));
}

#[test]
fn test_raise_dispute_on_completed_task_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, orchestrator, task_id) = setup_dispute_task(&test_env, resolver);
    test_env.client.complete_task(&orchestrator, &task_id);

    let result = test_env.client.try_raise_dispute(&user, &task_id);
    assert!(result == Err(Ok(VaultError::TaskAlreadyCompleted)));
}

#[test]
fn test_raise_dispute_nonexistent_task_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let user = Address::generate(&test_env.env);

    let result = test_env.client.try_raise_dispute(&user, &999);
    assert!(result == Err(Ok(VaultError::TaskNotFound)));
}

#[test]
fn test_raise_dispute_twice_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver);
    test_env.client.raise_dispute(&user, &task_id);

    let result = test_env.client.try_raise_dispute(&user, &task_id);
    assert!(result == Err(Ok(VaultError::TaskDisputed)));
}

#[test]
fn test_resolve_dispute_split_mismatch_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());
    test_env.client.raise_dispute(&user, &task_id);

    // Remaining locked is 300; a 150/100 split does not sum to it.
    let result = test_env
        .client
        .try_resolve_dispute(&resolver, &task_id, &150, &100);
    assert!(result == Err(Ok(VaultError::DisputeSplitMismatch)));

    // The task is still disputed and unresolved.
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.disputed);
    assert!(!task.completed);
}

#[test]
fn test_resolve_dispute_negative_split_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());
    test_env.client.raise_dispute(&user, &task_id);

    let result = test_env
        .client
        .try_resolve_dispute(&resolver, &task_id, &-1, &301);
    assert!(result == Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_resolve_dispute_on_non_disputed_task_fails() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (_user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    let result = test_env
        .client
        .try_resolve_dispute(&resolver, &task_id, &300, &0);
    assert!(result == Err(Ok(VaultError::TaskNotDisputed)));
}

#[test]
fn test_cancel_task_blocked_by_dispute() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver);
    test_env.client.raise_dispute(&user, &task_id);

    let result = test_env.client.try_cancel_task(&user, &task_id);
    assert!(result == Err(Ok(VaultError::TaskDisputed)));

    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.disputed);
    assert!(!task.completed);
}

#[test]
fn test_force_complete_stale_task_blocked_by_dispute() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);

    test_env.env.ledger().set_timestamp(1000);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver);
    test_env.client.raise_dispute(&user, &task_id);

    // Well past the stale threshold, but the dispute must win.
    test_env.env.ledger().set_timestamp(1000 + 1801);
    assert_eq!(
        test_env.client.get_task_status(&task_id),
        Some(TaskStatus::Disputed)
    );

    let result = test_env.client.try_force_complete_stale_task(&task_id);
    assert!(result == Err(Ok(VaultError::TaskDisputed)));

    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.disputed);
    assert!(!task.completed);
}

#[test]
fn test_dispute_interaction_with_pause() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    test_env.client.pause(&test_env.admin);

    // A user can still raise a dispute while paused (protection stays open).
    test_env.client.raise_dispute(&user, &task_id);
    assert!(test_env.client.get_task(&task_id).unwrap().disputed);

    // But the resolver cannot move funds while paused.
    let result = test_env
        .client
        .try_resolve_dispute(&resolver, &task_id, &300, &0);
    assert!(result == Err(Ok(VaultError::ContractPaused)));

    // After unpausing, resolution proceeds.
    test_env.client.unpause(&test_env.admin);
    test_env
        .client
        .resolve_dispute(&resolver, &task_id, &300, &0);
    let task = test_env.client.get_task(&task_id).unwrap();
    assert!(task.completed);
}

#[test]
fn test_dispute_events_emitted() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, _orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    // raise_dispute emits exactly one event: DisputeRaisedEvent.
    test_env.client.raise_dispute(&user, &task_id);
    let expected_raise: soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> = soroban_sdk::vec![
        &test_env.env,
        (
            test_env.contract_id.clone(),
            soroban_sdk::vec![
                &test_env.env,
                Symbol::new(&test_env.env, "dispute_raised_event").into_val(&test_env.env),
                user.clone().into_val(&test_env.env),
                task_id.into_val(&test_env.env),
            ],
            soroban_sdk::Map::<Val, Val>::new(&test_env.env).into_val(&test_env.env),
        ),
    ];
    assert_eq!(
        test_env
            .env
            .events()
            .all()
            .filter_by_contract(&test_env.contract_id),
        expected_raise
    );

    // resolve_dispute emits exactly one event: DisputeResolvedEvent, carrying
    // the refund/payout split in the data payload.
    test_env
        .client
        .resolve_dispute(&resolver, &task_id, &80, &220);
    let expected_resolve: soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)> = soroban_sdk::vec![
        &test_env.env,
        (
            test_env.contract_id.clone(),
            soroban_sdk::vec![
                &test_env.env,
                Symbol::new(&test_env.env, "dispute_resolved_event").into_val(&test_env.env),
                resolver.clone().into_val(&test_env.env),
                task_id.into_val(&test_env.env),
            ],
            soroban_sdk::map![
                &test_env.env,
                (Symbol::new(&test_env.env, "refund_to_user"), 80i128),
                (
                    Symbol::new(&test_env.env, "payout_to_orchestrator"),
                    220i128
                ),
            ]
            .into_val(&test_env.env),
        ),
    ];
    assert_eq!(
        test_env
            .env
            .events()
            .all()
            .filter_by_contract(&test_env.contract_id),
        expected_resolve
    );
}

#[test]
fn test_resolve_dispute_full_payout_to_orchestrator() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    test_env.client.raise_dispute(&user, &task_id);

    // Full remaining locked amount goes to the orchestrator, nothing to the user.
    test_env
        .client
        .resolve_dispute(&resolver, &task_id, &0, &300);

    assert_eq!(test_env.token_client.balance(&user), 500); // 1000 - 500 deposit, no refund
    assert_eq!(test_env.token_client.balance(&orchestrator), 300);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 200);

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 200);
    assert_eq!(account.total_spent, 300);
    assert_eq!(account.active_tasks_count, 0);
}

#[test]
fn test_dispute_resolution_does_not_claw_back_spent() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);
    let resolver = Address::generate(&test_env.env);
    let (user, orchestrator, task_id) = setup_dispute_task(&test_env, resolver.clone());

    // 200 already released; remaining locked = 100.
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &200);
    test_env.client.raise_dispute(&user, &task_id);

    // Resolution only touches the still-locked 100; the released 200 stays out.
    test_env
        .client
        .resolve_dispute(&resolver, &task_id, &100, &0);

    assert_eq!(test_env.token_client.balance(&orchestrator), 200);
    assert_eq!(test_env.token_client.balance(&test_env.contract_id), 200); // 500 - 200 - 100

    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.locked, 0);
    assert_eq!(account.balance, 200); // 500 - plan_cost(300)
    assert_eq!(account.total_spent, 200); // only the released amount is spending
}

// ── Protocol Fee Tests ────────────────────────────────────────────────────────

// Helper: set up a full task scenario with a funded user+orchestrator ready to
// call release_payment. Returns (user, orchestrator, task_id).
fn setup_fee_task(test_env: &TestEnv, plan_cost: i128) -> (Address, Address, u64) {
    let user = Address::generate(&test_env.env);
    let orchestrator = Address::generate(&test_env.env);
    test_env.token_admin_client.mint(&user, &plan_cost);
    test_env
        .client
        .deposit(&user, &test_env.usdc_sac, &plan_cost);
    test_env.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&test_env.env, "fee-orchestrator"),
    );
    let task_id = test_env
        .client
        .create_task(&orchestrator, &test_env.usdc_sac, &plan_cost);
    (user, orchestrator, task_id)
}

// 18a. set_fee — basic read-back

#[test]
fn test_set_fee_and_get_fee() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &50, &Some(recipient.clone()));

    let (bps, rec) = test_env.client.get_fee();
    assert_eq!(bps, 50);
    assert_eq!(rec, Some(recipient));
}

// 18b. set_fee — default is zero / None

#[test]
fn test_get_fee_default() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let (bps, rec) = test_env.client.get_fee();
    assert_eq!(bps, 0);
    assert_eq!(rec, None);
}

// 18c. set_fee — exceeds cap is rejected

#[test]
fn test_set_fee_exceeds_cap() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let result = test_env.client.try_set_fee(&test_env.admin, &1001, &None);
    assert!(result == Err(Ok(VaultError::FeeBpsExceedsCap)));
}

// 18d. set_fee — exact cap (1000 bps) is accepted

#[test]
fn test_set_fee_at_cap() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &1000, &Some(recipient.clone()));
    let (bps, _) = test_env.client.get_fee();
    assert_eq!(bps, 1000);
}

// 18e. set_fee — non-admin is rejected

#[test]
fn test_set_fee_unauthorized() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let attacker = Address::generate(&test_env.env);
    let result = test_env.client.try_set_fee(&attacker, &50, &None);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

// 18f. release_payment with fee — correct split and accrual

#[test]
fn test_release_payment_fee_accrual() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    // 100 bps = 1%
    test_env
        .client
        .set_fee(&test_env.admin, &100, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 10_000);
    // release 1000; fee = floor(1000 * 100 / 10_000) = 10
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &1000);

    // Orchestrator receives 990
    assert_eq!(test_env.token_client.balance(&orchestrator), 990);
    // 10 stays in contract, accrued for recipient
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 10);
}

// 18g. claim_fees — transfers accrued fees and zeroes the balance

#[test]
fn test_claim_fees() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &200, &Some(recipient.clone())); // 2%

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 5_000);
    // fee = floor(5000 * 200 / 10_000) = 100
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &5_000);

    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 100);

    let claimed = test_env.client.claim_fees(&recipient, &test_env.usdc_sac);
    assert_eq!(claimed, 100);
    assert_eq!(test_env.token_client.balance(&recipient), 100);
    // Accrual zeroed after claim
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 0);
}

// 18h. claim_fees — no-op when nothing accrued returns NoFeesAccrued

#[test]
fn test_claim_fees_nothing_accrued() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &100, &Some(recipient.clone()));

    let result = test_env
        .client
        .try_claim_fees(&recipient, &test_env.usdc_sac);
    assert!(result == Err(Ok(VaultError::NoFeesAccrued)));
}

// 18i. claim_fees — wrong caller is rejected

#[test]
fn test_claim_fees_wrong_caller() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    let attacker = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &100, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 1_000);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &1_000);

    let result = test_env
        .client
        .try_claim_fees(&attacker, &test_env.usdc_sac);
    assert!(result == Err(Ok(VaultError::Unauthorized)));
}

// 18j. Zero-fee path — zero bps behaves exactly like no fee configured
//      (orchestrator receives full amount, no accrual)

#[test]
fn test_zero_fee_no_deduction() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    // Explicitly set 0 bps
    test_env
        .client
        .set_fee(&test_env.admin, &0, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 1_000);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &1_000);

    // Orchestrator receives full amount; nothing accrued
    assert_eq!(test_env.token_client.balance(&orchestrator), 1_000);
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 0);
}

// 18k. Zero-fee path — fee set but recipient is None

#[test]
fn test_fee_no_recipient_no_deduction() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    // bps set but no recipient
    test_env.client.set_fee(&test_env.admin, &500, &None);

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 1_000);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &1_000);

    assert_eq!(test_env.token_client.balance(&orchestrator), 1_000);
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 0);
}

// 18l. Dust: amount so small fee rounds to 0 — orchestrator gets full amount

#[test]
fn test_fee_dust_rounds_to_zero() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    // 1 bps = 0.01%; on amount=9 the fee = floor(9*1/10_000) = 0
    test_env
        .client
        .set_fee(&test_env.admin, &1, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 9);
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &9);

    assert_eq!(test_env.token_client.balance(&orchestrator), 9);
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 0);
}

// 18m. Recipient equals orchestrator — allowed by spec

#[test]
fn test_fee_recipient_is_orchestrator() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 10_000);
    // Set recipient = orchestrator after task creation (fee config doesn't affect tasks retroactively)
    test_env
        .client
        .set_fee(&test_env.admin, &100, &Some(orchestrator.clone())); // 1%

    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &10_000);

    // Orchestrator payout = 9900, fee accrued = 100
    assert_eq!(test_env.token_client.balance(&orchestrator), 9_900);
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 100);
}

// 18n. Cumulative accrual across multiple releases

#[test]
fn test_fee_cumulative_accrual() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    // 200 bps = 2%
    test_env
        .client
        .set_fee(&test_env.admin, &200, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 3_000);
    // Three releases of 1000 each: fee per release = 20; total = 60
    for step_id in 1u64..=3 {
        test_env.client.release_payment(
            &orchestrator,
            &task_id,
            &step_id,
            &test_env.usdc_sac,
            &1_000,
        );
    }

    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 60);
    // Orchestrator received 980 × 3 = 2940
    assert_eq!(test_env.token_client.balance(&orchestrator), 2_940);
}

// 18o. Invariant: sum(orchestrator payouts) + sum(fees) + refund == plan_cost
//      Randomised-style invariant over 5 partial releases + completion.

#[test]
fn test_fee_accounting_invariant() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    let bps: i128 = 150; // 1.5%
    test_env
        .client
        .set_fee(&test_env.admin, &(bps as u32), &Some(recipient.clone()));

    let plan_cost: i128 = 10_000;
    let (user, orchestrator, task_id) = setup_fee_task(&test_env, plan_cost);
    let contract_before = test_env.token_client.balance(&test_env.contract_id);

    // Partial release sequence: 1000, 2000, 1500, 2500, 1000 = 8000 total released
    let releases: [i128; 5] = [1_000, 2_000, 1_500, 2_500, 1_000];
    let mut total_released = 0i128;
    let mut expected_fees = 0i128;
    for (step_id, &r) in releases.iter().enumerate() {
        test_env.client.release_payment(
            &orchestrator,
            &task_id,
            &((step_id + 1) as u64),
            &test_env.usdc_sac,
            &r,
        );
        let fee = r * bps / 10_000;
        expected_fees += fee;
        total_released += r;
    }

    test_env.client.complete_task(&orchestrator, &task_id);

    let refund = plan_cost - total_released;
    let orchestrator_balance = test_env.token_client.balance(&orchestrator);
    let accrued = test_env.client.get_accrued_fees(&test_env.usdc_sac);
    let contract_after = test_env.token_client.balance(&test_env.contract_id);

    // orchestrator received total_released - total_fees
    assert_eq!(orchestrator_balance, total_released - expected_fees);
    // fees accrued match our expected sum
    assert_eq!(accrued, expected_fees);
    // contract balance decreased by exactly total_released - fees (fees stay in contract)
    assert_eq!(
        contract_before - contract_after,
        total_released - expected_fees
    );
    // The full invariant: payout + fees + refund == plan_cost
    assert_eq!(orchestrator_balance + accrued + refund, plan_cost);

    // Verify user got refund back into available balance
    let account = test_env
        .client
        .get_account(&user, &test_env.usdc_sac)
        .unwrap();
    assert_eq!(account.balance, plan_cost - total_released);
}

// 18p. Fee config change does NOT affect already-released amounts
//      (i.e., changing bps mid-task only affects future release_payment calls)

#[test]
fn test_fee_change_not_retroactive() {
    let test_env = setup_test();
    test_env.client.init(&test_env.admin, &test_env.usdc_sac);

    let recipient = Address::generate(&test_env.env);
    test_env
        .client
        .set_fee(&test_env.admin, &0, &Some(recipient.clone()));

    let (_, orchestrator, task_id) = setup_fee_task(&test_env, 2_000);
    // First release at 0 bps — no fee
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &1, &test_env.usdc_sac, &1_000);
    assert_eq!(test_env.token_client.balance(&orchestrator), 1_000);

    // Change fee to 10% mid-task
    test_env
        .client
        .set_fee(&test_env.admin, &1000, &Some(recipient.clone()));

    // Second release at 10% — fee = 100
    test_env
        .client
        .release_payment(&orchestrator, &task_id, &2, &test_env.usdc_sac, &1_000);
    // Total orchestrator: 1000 (full, no fee) + 900 (after 10% fee) = 1900
    assert_eq!(test_env.token_client.balance(&orchestrator), 1_900);
    assert_eq!(test_env.client.get_accrued_fees(&test_env.usdc_sac), 100);
}

// ─────────────────────────────────────────────────────────────────────────
// Reentrancy hardening (#104): adversarial malicious-token tests
// ─────────────────────────────────────────────────────────────────────────

struct MaliciousSetup {
    env: Env,
    admin: Address,
    mal_token: Address,
    mal_client: MaliciousTokenClient<'static>,
    contract_id: Address,
    client: AgentVaultClient<'static>,
}

fn setup_malicious() -> MaliciousSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let mal_token = env.register(MaliciousToken, ());
    let mal_client = MaliciousTokenClient::new(&env, &mal_token);

    let contract_id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &contract_id);

    // init() needs a real-shaped usdc_sac address for the required-asset
    // slot; the malicious token is added as an additional supported asset.
    let usdc_sac = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    client.init(&admin, &usdc_sac);
    client.add_asset(&admin, &mal_token);

    MaliciousSetup {
        env,
        admin,
        mal_token,
        mal_client,
        contract_id,
        client,
    }
}

fn disarmed_config(setup: &MaliciousSetup) -> ReentryConfig {
    // A neutral config with `action = None`; individual tests overwrite the
    // fields relevant to the action they arm.
    let zero_addr = setup.admin.clone();
    ReentryConfig {
        vault: setup.contract_id.clone(),
        action: ReentryAction::None,
        withdraw_user: zero_addr.clone(),
        withdraw_asset: setup.mal_token.clone(),
        withdraw_amount: 0,
        release_orchestrator: zero_addr.clone(),
        release_task_id: 0,
        release_step_id: 0,
        release_asset: setup.mal_token.clone(),
        release_amount: 0,
    }
}

#[test]
fn test_reentrant_withdraw_cannot_double_withdraw() {
    let setup = setup_malicious();
    let user = Address::generate(&setup.env);

    setup.mal_client.mint(&user, &1_000);
    setup.client.deposit(&user, &setup.mal_token, &1_000);
    assert_eq!(setup.client.get_balance(&user, &setup.mal_token), 1_000);

    // Arm: while the vault is paying the user 600, the malicious token's
    // transfer hook tries to withdraw ANOTHER 600 for the same user before
    // the outer withdraw call has returned.
    let mut cfg = disarmed_config(&setup);
    cfg.action = ReentryAction::Withdraw;
    cfg.withdraw_user = user.clone();
    cfg.withdraw_asset = setup.mal_token.clone();
    cfg.withdraw_amount = 600;
    setup.mal_client.configure(&cfg);

    setup.client.withdraw(&user, &setup.mal_token, &600);

    // CEI fix: the first withdraw already debited the vault balance before
    // calling transfer, so the re-entrant second withdraw for 600 must have
    // been rejected (only 400 remained available).
    assert!(setup.mal_client.reentry_attempted());
    assert!(!setup.mal_client.reentry_succeeded());

    // Exactly one payout of 600 left the vault — not 1200.
    assert_eq!(setup.mal_client.balance(&user), 600);
    assert_eq!(setup.client.get_balance(&user, &setup.mal_token), 400);
    assert_eq!(setup.client.get_available(&user, &setup.mal_token), 400);
}

#[test]
fn test_reentrant_release_payment_cannot_exceed_plan_cost() {
    let setup = setup_malicious();
    let user = Address::generate(&setup.env);
    let orchestrator = Address::generate(&setup.env);

    setup.mal_client.mint(&user, &1_000);
    setup.client.deposit(&user, &setup.mal_token, &1_000);
    setup.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&setup.env, "mal-orchestrator"),
    );
    let task_id = setup
        .client
        .create_task(&orchestrator, &setup.mal_token, &1_000);

    // Arm: while step 1 releases 700, the token's transfer hook tries to
    // release a DIFFERENT step (step 2) for another 700 — which would blow
    // past plan_cost (1000) if task.spent weren't bumped before the transfer.
    let mut cfg = disarmed_config(&setup);
    cfg.action = ReentryAction::ReleasePayment;
    cfg.release_orchestrator = orchestrator.clone();
    cfg.release_task_id = task_id;
    cfg.release_step_id = 2;
    cfg.release_asset = setup.mal_token.clone();
    cfg.release_amount = 700;
    setup.mal_client.configure(&cfg);

    setup
        .client
        .release_payment(&orchestrator, &task_id, &1, &setup.mal_token, &700);

    assert!(setup.mal_client.reentry_attempted());
    assert!(!setup.mal_client.reentry_succeeded());

    let task = setup.client.get_task(&task_id).unwrap();
    assert!(task.spent <= task.plan_cost);
    assert_eq!(task.spent, 700);
    assert_eq!(setup.mal_client.balance(&orchestrator), 700);
}

#[test]
fn test_cross_function_reentrancy_release_payment_into_withdraw() {
    let setup = setup_malicious();
    let user = Address::generate(&setup.env);
    let orchestrator = Address::generate(&setup.env);

    // Extra unlocked funds sitting in the user's balance, outside the task,
    // that a cross-function reentrant withdraw would try to drain.
    setup.mal_client.mint(&user, &1_500);
    setup.client.deposit(&user, &setup.mal_token, &1_500);
    setup.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&setup.env, "mal-orchestrator-2"),
    );
    let task_id = setup
        .client
        .create_task(&orchestrator, &setup.mal_token, &500);
    // Available balance outside the task's locked 500: 1500 - 500 = 1000.
    assert_eq!(setup.client.get_available(&user, &setup.mal_token), 1_000);

    // Arm: release_payment's transfer hook re-enters as a WITHDRAW for the
    // user, not another release_payment.
    let mut cfg = disarmed_config(&setup);
    cfg.action = ReentryAction::Withdraw;
    cfg.withdraw_user = user.clone();
    cfg.withdraw_asset = setup.mal_token.clone();
    cfg.withdraw_amount = 1_000;
    setup.mal_client.configure(&cfg);

    setup
        .client
        .release_payment(&orchestrator, &task_id, &1, &setup.mal_token, &500);

    // The cross-function reentrant withdraw is legitimate on its own (the
    // 1000 available balance is real and untouched by the task) — CEI
    // ordering doesn't need to block it, only ensure accounting stays
    // consistent. release_payment never touches asset_account.balance
    // directly (only withdraw and finalize_task do), so the vault ledger
    // here must equal deposit minus whatever the reentrant withdraw paid
    // out — independent of the orchestrator's separate payout.
    assert!(setup.mal_client.reentry_attempted());
    let user_asset_balance = setup.client.get_balance(&user, &setup.mal_token);
    let user_token_balance = setup.mal_client.balance(&user);
    let orch_token_balance = setup.mal_client.balance(&orchestrator);

    assert_eq!(orch_token_balance, 500);
    // Empirically the reentrant withdraw here does not succeed (verified via
    // cargo test, not assumed): reentry_succeeded() is false and the vault's
    // own balance write never committed, so user_token_balance stays 0. The
    // safety property under test doesn't depend on which way this goes --
    // only that whatever happens is consistent and no double payout occurs.
    assert!(!setup.mal_client.reentry_succeeded());
    assert_eq!(user_token_balance, 0);
    assert_eq!(
        user_asset_balance,
        1_500 - user_token_balance,
        "vault ledger must exactly match tokens actually paid out via withdraw"
    );
    // The task's 500 stays locked until finalize_task runs (not yet called
    // here), so available balance reflects that regardless of the reentrant
    // withdraw's outcome.
    assert_eq!(
        setup.client.get_available(&user, &setup.mal_token),
        user_asset_balance - 500
    );
}

#[test]
fn test_finalize_task_dispute_reentry_blocked_by_completed_flag() {
    let setup = setup_malicious();
    let user = Address::generate(&setup.env);
    let orchestrator = Address::generate(&setup.env);

    setup.mal_client.mint(&user, &1_000);
    setup.client.deposit(&user, &setup.mal_token, &1_000);
    setup.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&setup.env, "mal-orchestrator-3"),
    );
    let task_id = setup
        .client
        .create_task(&orchestrator, &setup.mal_token, &1_000);
    setup
        .client
        .set_dispute_resolver(&setup.admin, &setup.admin);
    setup.client.raise_dispute(&user, &task_id);

    // Arm: the dispute refund/payout transfer's hook tries to re-enter with
    // ANOTHER withdraw before this contract call returns.
    let mut cfg = disarmed_config(&setup);
    cfg.action = ReentryAction::Withdraw;
    cfg.withdraw_user = user.clone();
    cfg.withdraw_asset = setup.mal_token.clone();
    cfg.withdraw_amount = 500;
    setup.mal_client.configure(&cfg);

    setup
        .client
        .resolve_dispute(&setup.admin, &task_id, &500, &500);

    // The full 1000 was locked into this single task, so
    // finalize_task's asset_account.balance write (committed before either
    // dispute transfer runs) already brings the user's vault balance to 0.
    // The reentrant withdraw therefore has nothing left to take — proving
    // task.completed and the balance write are both visible to the
    // reentrant call before any token leaves the contract.
    assert!(setup.mal_client.reentry_attempted());
    assert!(!setup.mal_client.reentry_succeeded());

    let task = setup.client.get_task(&task_id).unwrap();
    assert!(task.completed);
    assert_eq!(setup.client.get_balance(&user, &setup.mal_token), 0);
    // Refund (500) + orchestrator payout (500) == plan_cost, paid exactly once.
    assert_eq!(setup.mal_client.balance(&user), 500);
    assert_eq!(setup.mal_client.balance(&orchestrator), 500);
}

#[test]
fn test_paused_reentrant_release_payment_blocked_via_withdraw_hook() {
    let setup = setup_malicious();
    let user = Address::generate(&setup.env);
    let orchestrator = Address::generate(&setup.env);

    setup.mal_client.mint(&user, &1_000);
    setup.client.deposit(&user, &setup.mal_token, &1_000);
    setup.client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&setup.env, "mal-orchestrator-4"),
    );
    // create_task itself checks require_not_paused, so the task must exist
    // BEFORE the vault is paused.
    let task_id = setup
        .client
        .create_task(&orchestrator, &setup.mal_token, &400);
    let task_before = setup.client.get_task(&task_id).unwrap();

    setup.client.pause(&setup.admin);

    // withdraw intentionally bypasses the pause guard (it's the user's exit
    // hatch), so it's still callable here. Arm the hook to try a reentrant
    // release_payment from inside withdraw's transfer — release_payment DOES
    // check require_not_paused, so this must be rejected even though it was
    // triggered from a call that itself ignores pause.
    let mut cfg = disarmed_config(&setup);
    cfg.action = ReentryAction::ReleasePayment;
    cfg.release_orchestrator = orchestrator.clone();
    cfg.release_task_id = task_id;
    cfg.release_step_id = 1;
    cfg.release_asset = setup.mal_token.clone();
    cfg.release_amount = 400;
    setup.mal_client.configure(&cfg);

    // available = balance(1000) - locked(400) = 600.
    setup.client.withdraw(&user, &setup.mal_token, &600);

    assert!(setup.mal_client.reentry_attempted());
    assert!(!setup.mal_client.reentry_succeeded());

    // The reentrant release_payment must not have moved anything: task
    // untouched, nothing paid to the orchestrator, locked funds untouched.
    let task_after = setup.client.get_task(&task_id).unwrap();
    assert_eq!(task_after.spent, task_before.spent);
    assert!(!task_after.completed);
    assert_eq!(setup.mal_client.balance(&orchestrator), 0);

    // The outer withdraw (which does bypass pause) completed normally.
    assert_eq!(setup.mal_client.balance(&user), 600);
    assert_eq!(setup.client.get_balance(&user, &setup.mal_token), 400);
    // Locked (400) is untouched by either call, so available is 0.
    assert_eq!(setup.client.get_available(&user, &setup.mal_token), 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Private spending-policy commitment + proof-gated release (#122)
//
// Every test below demonstrates one specific way the policy gate could be
// silently bypassed, and asserts it is rejected:
//   * a committed task paid through the plain (unconstrained) path,
//   * a plain task paid through the proof path,
//   * a nullifier replayed for a second release,
//   * a proof whose bound (payee, amount) differs from the release,
//   * a release attempted with no verifier configured (must fail closed),
//   * a rejected proof burning a nullifier a later valid proof needs,
//   * the verifier being consulted for an over-budget request,
//   * a disputed / stale-forced committed task still being paid.
// ─────────────────────────────────────────────────────────────────────────

struct PolicySetup {
    env: Env,
    admin: Address,
    usdc_sac: Address,
    contract_id: Address,
    client: AgentVaultClient<'static>,
    token_client: token::Client<'static>,
    verifier_id: Address,
    verifier: MockVerifierClient<'static>,
    user: Address,
    orchestrator: Address,
}

fn setup_policy() -> PolicySetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let usdc_sac = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &contract_id);
    let token_client = token::Client::new(&env, &usdc_sac);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc_sac);

    let verifier_id = env.register(MockVerifier, ());
    let verifier = MockVerifierClient::new(&env, &verifier_id);

    client.init(&admin, &usdc_sac);

    let user = Address::generate(&env);
    let orchestrator = Address::generate(&env);
    token_admin_client.mint(&user, &100_000);
    client.deposit(&user, &usdc_sac, &50_000);
    client.register_orchestrator(
        &user,
        &orchestrator,
        &soroban_sdk::String::from_str(&env, "policy-orch"),
    );

    PolicySetup {
        env,
        admin,
        usdc_sac,
        contract_id,
        client,
        token_client,
        verifier_id,
        verifier,
        user,
        orchestrator,
    }
}

/// A non-zero 32-byte commitment seeded distinctly per test.
fn commitment_of(env: &Env, seed: u8) -> BytesN<32> {
    let mut b = [0u8; 32];
    b[0] = seed;
    b[31] = 0xAA;
    BytesN::from_array(env, &b)
}

/// A 32-byte nullifier seeded distinctly per call.
fn nullifier_of(env: &Env, seed: u8) -> BytesN<32> {
    let mut b = [0x11u8; 32];
    b[0] = seed;
    BytesN::from_array(env, &b)
}

/// Opaque proof bytes — their content is irrelevant to the vault; the mock
/// verifier ignores them and the vault never inspects, logs, or emits them.
fn dummy_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[9, 8, 7, 6, 5, 4, 3, 2, 1])
}

// ── Phase 1: policy commitment & mutual exclusion ──────────────────────

#[test]
fn test_plain_create_task_records_no_commitment() {
    let s = setup_policy();
    let task_id = s.client.create_task(&s.orchestrator, &s.usdc_sac, &1_000);
    // The plain path must NEVER record a commitment.
    assert_eq!(s.client.get_task_policy(&task_id), None);
    assert_eq!(s.client.get_task(&task_id).unwrap().policy_commitment, None);
}

#[test]
fn test_create_task_with_policy_records_commitment() {
    let s = setup_policy();
    let c = commitment_of(&s.env, 1);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);

    assert_eq!(s.client.get_task_policy(&task_id), Some(c.clone()));
    assert_eq!(
        s.client.get_task(&task_id).unwrap().policy_commitment,
        Some(c)
    );
    // Budget is locked exactly as on the plain path.
    let acct = s.client.get_account(&s.user, &s.usdc_sac).unwrap();
    assert_eq!(acct.locked, 1_000);
    assert_eq!(acct.active_tasks_count, 1);
}

#[test]
fn test_create_task_with_policy_rejects_zero_commitment() {
    let s = setup_policy();
    let zero = BytesN::from_array(&s.env, &[0u8; 32]);
    let res = s
        .client
        .try_create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &zero);
    assert!(res == Err(Ok(VaultError::InvalidCommitment)));
    // No task created, no budget locked.
    let acct = s.client.get_account(&s.user, &s.usdc_sac).unwrap();
    assert_eq!(acct.locked, 0);
    assert_eq!(acct.active_tasks_count, 0);
}

#[test]
fn test_set_policy_verifier_requires_admin() {
    let s = setup_policy();
    let not_admin = Address::generate(&s.env);

    let res = s.client.try_set_policy_verifier(&not_admin, &s.verifier_id);
    assert!(res == Err(Ok(VaultError::Unauthorized)));
    assert_eq!(s.client.get_policy_verifier(), None);

    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    assert_eq!(s.client.get_policy_verifier(), Some(s.verifier_id.clone()));
}

#[test]
fn test_set_policy_verifier_is_admin_mutable() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    assert_eq!(s.client.get_policy_verifier(), Some(s.verifier_id.clone()));

    // Admin may replace the verifier at any time (matches set_dispute_resolver).
    let v2 = s.env.register(MockVerifier, ());
    s.client.set_policy_verifier(&s.admin, &v2);
    assert_eq!(s.client.get_policy_verifier(), Some(v2));
}

#[test]
fn test_committed_task_rejects_plain_release_payment() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 2);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);

    // The plain path must refuse a committed task even though the verifier
    // would accept anything — mutual exclusion is structural.
    let res = s
        .client
        .try_release_payment(&s.orchestrator, &task_id, &1, &s.usdc_sac, &100);
    assert!(res == Err(Ok(VaultError::PolicyProofRequired)));
    assert_eq!(s.token_client.balance(&s.orchestrator), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);
    assert_eq!(s.verifier.calls(), 0);
}

#[test]
fn test_uncommitted_task_rejects_release_payment_proved() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let task_id = s.client.create_task(&s.orchestrator, &s.usdc_sac, &1_000);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &s.orchestrator,
        &nullifier_of(&s.env, 1),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::NoPolicyCommitment)));
    assert_eq!(s.token_client.balance(&s.orchestrator), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);
    assert_eq!(s.verifier.calls(), 0);
}

// ── Phase 2: proof-gated release ──────────────────────────────────────

#[test]
fn test_release_payment_proved_happy_path() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 3);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 10);
    let proof = dummy_proof(&s.env);

    let ok = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &400,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok);

    // Funds went to the proof-bound payee, not the orchestrator.
    assert_eq!(s.token_client.balance(&payee), 400);
    assert_eq!(s.token_client.balance(&s.orchestrator), 0);
    // State written before the transfer (CEI): spent bumped, nullifier consumed.
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 400);
    assert_eq!(s.verifier.calls(), 1);

    // The emitted event is `ReleaseProvedEvent`, whose fields are
    // `{user, orchestrator, task_id, asset, amount, nullifier}` — there is no
    // `proof` field, so proof bytes cannot ride in it, and the `log!` line in
    // `release_payment_proved` logs neither the proof nor the nullifier.
    // (The Soroban test host drops a frame's post-cross-contract-call events
    // from `env.events()`, so the release event's contents cannot be asserted
    // here directly; `test_create_task_with_policy_emits_extra_commitment_event`
    // covers the reliably-capturable policy event.)
}

/// `create_task_with_policy` performs no cross-contract call, so its events are
/// captured intact. It emits everything `create_task` does (one `TaskNewEvent`)
/// PLUS a `PolicyCommittedEvent` — and the commitment it carries is exactly the
/// opaque 32 bytes the caller passed, nothing more.
#[test]
fn test_create_task_with_policy_emits_extra_commitment_event() {
    let s = setup_policy();

    // Plain create_task: exactly one contract event.
    s.client.create_task(&s.orchestrator, &s.usdc_sac, &500);
    assert_eq!(
        s.env
            .events()
            .all()
            .filter_by_contract(&s.contract_id)
            .events()
            .len(),
        1
    );

    // create_task_with_policy: that one PLUS a PolicyCommittedEvent.
    let c = commitment_of(&s.env, 31);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &500, &c);
    assert_eq!(
        s.env
            .events()
            .all()
            .filter_by_contract(&s.contract_id)
            .events()
            .len(),
        2
    );
    // The commitment is retained verbatim — exactly the opaque bytes passed in.
    assert_eq!(s.client.get_task_policy(&task_id), Some(c));
}

#[test]
fn test_release_payment_proved_rejects_mismatched_binding() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    // The verifier only accepts a proof bound to (bound_payee, 400).
    s.verifier.configure(&VerifyMode::ExpectBinding);
    let bound_payee = Address::generate(&s.env);
    s.verifier.set_expected(&bound_payee, &400);

    let c = commitment_of(&s.env, 4);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let nf = nullifier_of(&s.env, 20);
    let proof = dummy_proof(&s.env);

    // Wrong payee for the proof binding.
    let other_payee = Address::generate(&s.env);
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &400,
        &other_payee,
        &nf,
        &proof,
    );
    assert!(res == Err(Ok(VaultError::PolicyProofRejected)));

    // Wrong amount for the proof binding.
    let res2 = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &2,
        &s.usdc_sac,
        &399,
        &bound_payee,
        &nf,
        &proof,
    );
    assert!(res2 == Err(Ok(VaultError::PolicyProofRejected)));

    // Nothing moved; the nullifier was not consumed by either rejected try.
    assert_eq!(s.token_client.balance(&other_payee), 0);
    assert_eq!(s.token_client.balance(&bound_payee), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);

    // The correctly-bound release now succeeds with that same nullifier.
    let ok = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &3,
        &s.usdc_sac,
        &400,
        &bound_payee,
        &nf,
        &proof,
    );
    assert!(ok);
    assert_eq!(s.token_client.balance(&bound_payee), 400);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 400);
}

#[test]
fn test_release_payment_proved_nullifier_replay_rejected() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 5);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 30);
    let proof = dummy_proof(&s.env);

    let ok = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &300,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok);
    assert_eq!(s.token_client.balance(&payee), 300);
    let calls_after_first = s.verifier.calls();

    // Same nullifier, a NEW step_id → replay, rejected before the verifier is
    // consulted, and no second transfer occurs.
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &2,
        &s.usdc_sac,
        &300,
        &payee,
        &nf,
        &proof,
    );
    assert!(res == Err(Ok(VaultError::NullifierAlreadyUsed)));
    assert_eq!(s.token_client.balance(&payee), 300);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 300);
    assert_eq!(s.verifier.calls(), calls_after_first);
}

#[test]
fn test_release_payment_proved_fails_closed_when_verifier_unset() {
    let s = setup_policy();
    // Deliberately DO NOT call set_policy_verifier.
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 6);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &payee,
        &nullifier_of(&s.env, 40),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::PolicyVerifierNotSet)));
    // Fail closed: no funds, no state change, and no verifier call attempted.
    assert_eq!(s.token_client.balance(&payee), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);
    assert_eq!(s.verifier.calls(), 0);
    assert_eq!(s.client.get_policy_verifier(), None);
}

#[test]
fn test_release_payment_proved_verifier_failure_does_not_burn_nullifier() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::RejectAll);

    let c = commitment_of(&s.env, 7);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 50);
    let proof = dummy_proof(&s.env);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &500,
        &payee,
        &nf,
        &proof,
    );
    assert!(res == Err(Ok(VaultError::PolicyProofRejected)));
    assert_eq!(s.token_client.balance(&payee), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);

    // Flip the verifier to accept: the SAME nullifier must still be spendable.
    // A rejected proof must not let anyone grief a later legitimate proof for
    // the same nullifier.
    s.verifier.configure(&VerifyMode::AcceptAll);
    let ok = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &500,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok);
    assert_eq!(s.token_client.balance(&payee), 500);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 500);
}

#[test]
fn test_release_payment_proved_budget_check_precedes_verifier() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 8);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);

    // amount exceeds the remaining budget → rejected BEFORE the verifier call.
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &1_001,
        &payee,
        &nullifier_of(&s.env, 60),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::ExceedsPlanCost)));
    // The mock verifier was never invoked for an over-budget request.
    assert_eq!(s.verifier.calls(), 0);
    assert_eq!(s.token_client.balance(&payee), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);
}

#[test]
fn test_release_payment_proved_blocked_on_disputed_task() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 9);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    s.client.raise_dispute(&s.user, &task_id);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &Address::generate(&s.env),
        &nullifier_of(&s.env, 70),
        &dummy_proof(&s.env),
    );
    // Same rejection an uncommitted task would get from the plain path.
    assert!(res == Err(Ok(VaultError::TaskDisputed)));
    assert_eq!(s.verifier.calls(), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);
}

#[test]
fn test_release_payment_proved_blocked_on_stale_forced_task() {
    let s = setup_policy();
    s.env.ledger().set_timestamp(1_000);
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 11);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);

    // Advance past the 1800s stale threshold and force-complete the task.
    s.env.ledger().set_timestamp(1_000 + 1_801);
    s.client.force_complete_stale_task(&task_id);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &Address::generate(&s.env),
        &nullifier_of(&s.env, 80),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::TaskAlreadyCompleted)));
    assert_eq!(s.verifier.calls(), 0);
}

#[test]
fn test_release_payment_proved_blocked_when_paused() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 12);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    s.client.pause(&s.admin);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &Address::generate(&s.env),
        &nullifier_of(&s.env, 90),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::ContractPaused)));
    assert_eq!(s.verifier.calls(), 0);
}

#[test]
fn test_release_payment_proved_wrong_orchestrator_rejected() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 13);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let stranger = Address::generate(&s.env);

    let res = s.client.try_release_payment_proved(
        &stranger,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &stranger,
        &nullifier_of(&s.env, 100),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::NotYourOrchestrator)));
    assert_eq!(s.verifier.calls(), 0);
}

#[test]
fn test_release_payment_proved_asset_mismatch_rejected() {
    let s = setup_policy();
    let other_asset = s
        .env
        .register_stellar_asset_contract_v2(s.admin.clone())
        .address();
    s.client.add_asset(&s.admin, &other_asset);
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 14);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);

    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &other_asset,
        &100,
        &s.orchestrator,
        &nullifier_of(&s.env, 110),
        &dummy_proof(&s.env),
    );
    assert!(res == Err(Ok(VaultError::AssetMismatch)));
    assert_eq!(s.verifier.calls(), 0);
}

#[test]
fn test_release_payment_proved_reverts_on_verifier_trap() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::Trap);

    let c = commitment_of(&s.env, 15);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 120);
    let proof = dummy_proof(&s.env);

    // A verifier that traps must fail closed: the whole release reverts, no
    // funds move, no state changes. (`try_` surfaces the revert as an Err
    // rather than unwinding the test.)
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &payee,
        &nf,
        &proof,
    );
    assert!(res.is_err());
    assert!(res != Ok(Ok(true)));
    assert_eq!(s.token_client.balance(&payee), 0);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 0);

    // ...and it did not burn the nullifier.
    s.verifier.configure(&VerifyMode::AcceptAll);
    let ok = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &100,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok);
    assert_eq!(s.token_client.balance(&payee), 100);
}

#[test]
fn test_release_payment_proved_fee_split() {
    let s = setup_policy();
    let fee_recipient = Address::generate(&s.env);
    s.client
        .set_fee(&s.admin, &100, &Some(fee_recipient.clone())); // 1%
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 18);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &10_000, &c);
    let payee = Address::generate(&s.env);

    s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &1_000,
        &payee,
        &nullifier_of(&s.env, 130),
        &dummy_proof(&s.env),
    );

    // fee = floor(1000 * 100 / 10_000) = 10; payee receives the remainder.
    assert_eq!(s.token_client.balance(&payee), 990);
    assert_eq!(s.client.get_accrued_fees(&s.usdc_sac), 10);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 1_000);
}

// ── Phase 3: invariant & lifecycle ───────────────────────────────────

#[test]
fn test_release_payment_proved_total_never_exceeds_budget() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 16);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let proof = dummy_proof(&s.env);

    // Four proved releases of 250 each == exactly the 1000 budget.
    for i in 0..4u8 {
        let ok = s.client.release_payment_proved(
            &s.orchestrator,
            &task_id,
            &(i as u64 + 1),
            &s.usdc_sac,
            &250,
            &payee,
            &nullifier_of(&s.env, 200 + i),
            &proof,
        );
        assert!(ok);
    }
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 1_000);
    assert_eq!(s.token_client.balance(&payee), 1_000);

    // One more unit must be rejected — the cap holds across many proved calls,
    // with a fresh, valid nullifier and the verifier accepting.
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &99,
        &s.usdc_sac,
        &1,
        &payee,
        &nullifier_of(&s.env, 240),
        &proof,
    );
    assert!(res == Err(Ok(VaultError::ExceedsPlanCost)));
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 1_000);

    // Vault accounting stays consistent: the task finalizes cleanly.
    s.client.complete_task(&s.orchestrator, &task_id);
    let acct = s.client.get_account(&s.user, &s.usdc_sac).unwrap();
    assert_eq!(acct.locked, 0);
    assert_eq!(acct.total_spent, 1_000);
    assert_eq!(acct.active_tasks_count, 0);
}

#[test]
fn test_release_payment_proved_idempotent_replay_same_step() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 17);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 210);
    let proof = dummy_proof(&s.env);

    let ok1 = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &300,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok1);
    let calls1 = s.verifier.calls();

    // Exact replay of the same (step_id, amount): idempotent success, no
    // second transfer, verifier not re-run.
    let ok2 = s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &300,
        &payee,
        &nf,
        &proof,
    );
    assert!(ok2);
    assert_eq!(s.token_client.balance(&payee), 300);
    assert_eq!(s.client.get_task(&task_id).unwrap().spent, 300);
    assert_eq!(s.verifier.calls(), calls1);

    // Same step_id, different amount → conflict.
    let res = s.client.try_release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &301,
        &payee,
        &nf,
        &proof,
    );
    assert!(res == Err(Ok(VaultError::ReleaseConflict)));
}

#[test]
fn test_release_payment_proved_nullifiers_pruned_on_finalize() {
    let s = setup_policy();
    s.client.set_policy_verifier(&s.admin, &s.verifier_id);
    s.verifier.configure(&VerifyMode::AcceptAll);

    let c = commitment_of(&s.env, 19);
    let task_id = s
        .client
        .create_task_with_policy(&s.orchestrator, &s.usdc_sac, &1_000, &c);
    let payee = Address::generate(&s.env);
    let nf = nullifier_of(&s.env, 220);

    s.client.release_payment_proved(
        &s.orchestrator,
        &task_id,
        &1,
        &s.usdc_sac,
        &400,
        &payee,
        &nf,
        &dummy_proof(&s.env),
    );

    // The consumed-nullifier marker exists while the task is live.
    let live = s.env.as_contract(&s.contract_id, || {
        s.env
            .storage()
            .persistent()
            .has(&DataKey::TaskNullifier(task_id, nf.clone()))
    });
    assert!(live);

    s.client.complete_task(&s.orchestrator, &task_id);

    // After finalization the marker and its index are pruned (rent reclaimed);
    // the commitment stays on the completed task record as an audit trail.
    let after = s.env.as_contract(&s.contract_id, || {
        let m = s
            .env
            .storage()
            .persistent()
            .has(&DataKey::TaskNullifier(task_id, nf.clone()));
        let idx = s
            .env
            .storage()
            .persistent()
            .has(&DataKey::TaskNullifierIds(task_id));
        (m, idx)
    });
    assert_eq!(after, (false, false));
    assert_eq!(s.client.get_task_policy(&task_id), Some(c));
}
