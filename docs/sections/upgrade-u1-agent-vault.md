# Upgrade Phase U1 — AgentVault Contract

## Goal

Deploy a Soroban smart contract that serves as the trustless treasury for AgentForge. It holds USDC for multiple users, manages per-user balances, registers personal orchestrators, and releases per-step payments to orchestrators during task execution. This is the foundation for phases U2–U7.

This phase is contract-only. No TypeScript client or dashboard changes. Those come in U3/U4.

---

## Architecture: Why a Treasury Contract?

**Phase 12 (BudgetGuardian)** — audit trail only. Tracked spend limits on-chain but moved no funds. The orchestrator held USDC and paid agents from its pre-loaded shared wallet.

**AgentVault (U1)** — actual custody. Users deposit USDC into the contract. The contract releases funds step-by-step to the orchestrator during task execution. The orchestrator is a relay, holding USDC for milliseconds before paying agents via standard x402.

```
User wallet (Freighter)
    ↓ deposit()
AgentVault contract (holds funds)
    ↓ release_payment() per step → orchestrator wallet (brief relay)
        ↓ standard x402 → agent wallet
```

**Key invariant**: the orchestrator wallet stays at ~0 USDC between steps. This is verifiable on stellar.expert — it proves the contract controls the funds, not the operator.

---

## Files Created

| File | Description |
|---|---|
| `contracts/agent-vault/Cargo.toml` | Rust crate config — mirrors budget-guardian, name `agent-vault`, soroban-sdk 25.3.0 |
| `contracts/agent-vault/src/lib.rs` | Contract implementation |
| `contracts/agent-vault/deploy.sh` | Automated build → deploy → init → smoke test → .env update |

The Phase 12 contract at `contracts/budget-guardian/` is **unchanged**. It stays as v1 for documentation continuity.

---

## Contract: `contracts/agent-vault/src/lib.rs`

### Storage layout

| Key | Type | Description |
|---|---|---|
| `Admin` (instance) | Address | Contract admin, set at init |
| `UsdcSac` (instance) | Address | USDC Stellar Asset Contract address |
| `TaskCounter` (instance) | u64 | Monotonically increasing task ID |
| `User(Address)` (persistent) | UserAccount | Per-user state |
| `Task(u64)` (persistent) | TaskInfo | Per-task state |
| `OrchestratorOwner(Address)` (persistent) | Address | Reverse lookup: orchestrator → user |

### `UserAccount` struct

```rust
pub struct UserAccount {
    pub balance: i128,              // total USDC held (available + locked), stroops
    pub locked: i128,               // reserved for active tasks
    pub total_deposited: i128,      // lifetime deposits (analytics)
    pub total_spent: i128,          // lifetime task spending (analytics)
    pub active_tasks_count: u32,    // must be 0 for new task or withdrawal
    pub orchestrator: Option<Address>,
    pub orchestrator_name: String,
    pub created_at: u64,
}
```

### `TaskInfo` struct

```rust
pub struct TaskInfo {
    pub user: Address,
    pub orchestrator: Address,
    pub plan_cost: i128,    // budget locked at task creation (sum of all step costs)
    pub spent: i128,        // released so far
    pub completed: bool,
    pub created_at: u64,
}
```

### Functions

| Function | Auth | Description |
|---|---|---|
| `init(admin, usdc_sac)` | admin | One-time setup |
| `deposit(user, amount)` | user | USDC user→contract, creates account on first call |
| `withdraw(user, amount)` | user | USDC contract→user; blocked if active_tasks_count > 0 |
| `register_orchestrator(user, orchestrator, name)` | user | One-time per user; sets up reverse lookup |
| `create_task(orchestrator, plan_cost)` | orchestrator | Locks plan_cost; enforces one-at-a-time per user |
| `release_payment(orchestrator, task_id, amount)` | orchestrator | Transfers USDC contract→orchestrator; enforces budget |
| `complete_task(orchestrator, task_id)` | orchestrator | Finalizes; refunds unused locked amount |
| `cancel_task(user, task_id)` | user | User abort; refunds unused locked amount |
| `force_complete_stale_task(task_id)` | anyone | Escape hatch after 30 minutes |
| `get_balance(user)` | none | Total USDC (available + locked), stroops |
| `get_available(user)` | none | Available (non-locked) USDC, stroops |
| `get_account(user)` | none | Full UserAccount struct |
| `get_task(task_id)` | none | Full TaskInfo struct |
| `get_orchestrator_owner(orchestrator)` | none | Reverse lookup |
| `task_count()` | none | Total tasks ever created |

### Key invariants enforced on-chain

- `init` can only be called once (`Admin` key presence check)
- `register_orchestrator` blocked if orchestrator already set on account
- `create_task` blocked if `active_tasks_count > 0` (one task per user)
- `create_task` blocked if available balance < plan_cost
- `release_payment` blocked if `spent + amount > plan_cost`
- `withdraw` blocked if `active_tasks_count > 0`
- `force_complete_stale_task` blocked if task is < 30 minutes old

### Balance accounting in `finalize_task`

```
account.locked  -= task.plan_cost   // unlock the full reservation
account.balance -= task.spent       // deduct only what was actually released
account.total_spent += task.spent
account.active_tasks_count -= 1
```

The refund (`plan_cost - spent`) is implicit: it was locked from balance, we unlock it but don't deduct it, so it's available again. No explicit transfer needed.

---

## Deploy Script: `contracts/agent-vault/deploy.sh`

Mirrors `budget-guardian/deploy.sh` exactly. Steps:

1. Verifies stellar-cli 25+ is on PATH
2. Loads `.env` and derives orchestrator public key via Node.js
3. Ensures testnet network is configured in stellar-cli
4. Runs `cargo build --target wasm32-unknown-unknown --release`
5. Deploys wasm to testnet via `stellar contract deploy --inclusion-fee 1000000`
6. Calls `init(admin=orchestrator_pubkey, usdc_sac=CBIELTK6...)` to initialize
7. Smoke-tests `task_count` (expect 0) and `get_available` (expect 0)
8. Prints contract ID and CLI test commands
9. Writes `AGENT_VAULT_CONTRACT_ID=<id>` to `.env` automatically

**USDC SAC on testnet:** `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

---

## Human Action Required: Build and Deploy

Run this yourself (compilation takes 1–3 minutes on first run):

```bash
cd /home/bosun/agentforge/contracts/agent-vault
./deploy.sh
```

After it completes, `AGENT_VAULT_CONTRACT_ID` will be auto-written to `.env`.

---

## Verification Checklist

Use the variables from the printed CLI test commands, or set them manually. You need:
- A test user wallet with USDC on testnet (fund at https://faucet.circle.com)
- A test orchestrator wallet with XLM only (friendbot fund at https://friendbot.stellar.org)

```bash
# Set test variables
export VAULT=<contract_id_from_deploy>
export USER_PUB=<test_user_public_key>
export USER_SEC=<test_user_secret_key>
export ORCH_PUB=<test_orchestrator_public_key>
export ORCH_SEC=<test_orchestrator_secret_key>

RPC="--rpc-url https://soroban-testnet.stellar.org --network-passphrase 'Test SDF Network ; September 2015'"

# 1. Register orchestrator (user signs)
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- register_orchestrator --user $USER_PUB --orchestrator $ORCH_PUB --name '"Phoenix"'
# Expected: success (empty output or void)

# 2. Re-registration should fail
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- register_orchestrator --user $USER_PUB --orchestrator $ORCH_PUB --name '"Atlas"'
# Expected: error "Orchestrator already registered for this user"

# 3. Reverse lookup
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_orchestrator_owner --orchestrator $ORCH_PUB
# Expected: returns $USER_PUB

# 4. Deposit 5 USDC (50,000,000 stroops)
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- deposit --user $USER_PUB --amount 50000000
# Expected: success; check stellar.expert that USDC moved from user → contract

# 5. Check balance
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_balance --user $USER_PUB
# Expected: 50000000

# 6. Check available
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_available --user $USER_PUB
# Expected: 50000000 (nothing locked)

# 7. Create task (orchestrator signs, plan_cost = 1 USDC)
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- create_task --orchestrator $ORCH_PUB --plan_cost 10000000
# Expected: returns 1 (task_id)

# 8. Available should now be 4 USDC (1 locked)
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_available --user $USER_PUB
# Expected: 40000000

# 9. Concurrent task blocked
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- create_task --orchestrator $ORCH_PUB --plan_cost 5000000
# Expected: error "User already has an active task"

# 10. Withdrawal blocked during active task
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- withdraw --user $USER_PUB --amount 10000000
# Expected: error "Cannot withdraw while tasks are active"

# 11. Release 0.2 USDC for task 1 → orchestrator wallet
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- release_payment --orchestrator $ORCH_PUB --task_id 1 --amount 2000000
# Expected: true
# VERIFY on stellar.expert: USDC moved contract → orchestrator wallet (NOT agent)

# 12. Over-budget release blocked
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- release_payment --orchestrator $ORCH_PUB --task_id 1 --amount 9000000
# Expected: error "Exceeds plan cost"

# 13. Complete task
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- complete_task --orchestrator $ORCH_PUB --task_id 1
# Expected: success

# 14. Balance = 4.8 USDC (5 - 0.2 spent; 0.8 unused refunded to available)
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_balance --user $USER_PUB
# Expected: 48000000

# 15. active_tasks_count = 0
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- get_account --user $USER_PUB
# Expected: active_tasks_count = 0

# 16. Withdrawal works now
stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- withdraw --user $USER_PUB --amount 10000000
# Expected: success; 1 USDC back to user wallet

# 17. cancel_task test
stellar contract invoke --id $VAULT $RPC --source $ORCH_SEC \
  -- create_task --orchestrator $ORCH_PUB --plan_cost 5000000
# Expected: returns 2

stellar contract invoke --id $VAULT $RPC --source $USER_SEC \
  -- cancel_task --user $USER_PUB --task_id 2
# Expected: success; balance restored; active_tasks_count = 0
```

### Checklist

- [ ] Contract builds without errors
- [ ] deploy.sh completes and prints contract ID
- [ ] init succeeds; AGENT_VAULT_CONTRACT_ID written to .env
- [ ] Smoke test: task_count = 0, get_available = 0
- [ ] register_orchestrator works once; blocked on retry
- [ ] get_orchestrator_owner returns correct user
- [ ] deposit works; USDC visible on stellar.expert at contract address
- [ ] get_balance and get_available return correct values
- [ ] create_task locks funds; available decreases
- [ ] Concurrent task creation blocked
- [ ] withdrawal blocked during active task
- [ ] release_payment sends USDC to ORCHESTRATOR (not agent) — verify on stellar.expert
- [ ] Over-budget release blocked
- [ ] complete_task: balance reflects refund of unspent amount
- [ ] active_tasks_count back to 0 after completion
- [ ] withdrawal works after task complete
- [ ] cancel_task restores balance

**Do not proceed to U2 until all items above are checked.**

---

## Comparison: BudgetGuardian (v1) vs AgentVault (v2)

| Feature | BudgetGuardian | AgentVault |
|---|---|---|
| Holds real USDC | No | Yes |
| Per-user accounts | No | Yes |
| Orchestrator registration | No | Yes (on-chain, user-signed) |
| Releases funds | No | Yes (contract→orchestrator) |
| Multi-user support | No | Yes |
| Withdrawal | No | Yes (with safety locks) |
| Cancel task | No | Yes |
| Force-complete escape hatch | No | Yes (30 min) |
| Purpose | Audit trail only | Full trustless treasury |
