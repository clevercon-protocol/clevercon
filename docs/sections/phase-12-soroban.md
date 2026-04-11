# Phase 12 — Soroban Budget Guardian Contract

## Goal

Deploy a Soroban smart contract that enforces on-chain budget limits for each task. Before every agent payment, the orchestrator calls the contract to approve the spend. If a payment would exceed the task budget, the contract returns `false` and the step is denied — enforcing programmable guardrails on the Stellar blockchain.

---

## Contract: `contracts/budget-guardian/`

### `Cargo.toml`
- `soroban-sdk = "22.0.0"` (matches Stellar CLI 22.x)
- `crate-type = ["cdylib"]` — required for Soroban wasm compilation
- Release profile: `opt-level = "z"`, LTO, strip symbols — minimises wasm size

### `src/lib.rs`

**Storage layout:**
- `DataKey::Admin` (instance) — admin address set at init, immutable
- `DataKey::TaskCounter` (instance) — monotonically increasing task ID
- `DataKey::Task(u64)` (persistent) — one `Task` struct per task ID

**`Task` struct fields:**
```rust
pub struct Task {
    pub owner: Address,
    pub budget: i128,       // stroops (1 USDC = 10_000_000)
    pub spent: i128,
    pub num_payments: u32,
    pub completed: bool,
    pub created_at: u64,
}
```

**Functions:**

| Function | Auth | Description |
|---|---|---|
| `init(admin)` | admin | One-time init, panics if called twice |
| `create_task(owner, budget)` | owner | Locks budget, returns task_id |
| `approve_spend(owner, task_id, amount)` | owner | Returns `true`/`false` — enforces budget |
| `complete_task(owner, task_id)` | owner | Marks task done, no further spends |
| `get_task(task_id)` | none | Read full Task struct |
| `get_remaining(task_id)` | none | Read remaining budget in stroops |
| `task_count()` | none | Total tasks created |

**Key invariants enforced on-chain:**
- Only the owner can create/approve/complete their own tasks (`require_auth`)
- `init` can only be called once
- `approve_spend` on a completed task panics
- Amounts must be positive

---

## Deploy Script: `contracts/budget-guardian/deploy.sh`

Automated build → deploy → init → verify flow:

```bash
cd contracts/budget-guardian
./deploy.sh
```

**Steps performed:**
1. Loads `.env` for `ORCHESTRATOR_SECRET_KEY`
2. Derives orchestrator public key via Node.js (falls back to `stellar keys public-key`)
3. Adds `orchestrator` key to stellar CLI keystore if missing
4. Configures `testnet` network if missing
5. Runs `stellar contract build` (compiles Rust → wasm)
6. Runs `stellar contract deploy` → prints contract ID
7. Calls `init(admin=orchestrator)` to initialise
8. Creates a test task (budget 1.5 USDC), approves 0.01 USDC spend, verifies remaining
9. Auto-updates `.env` with `BUDGET_CONTRACT_ID=<new_id>`

**Run it yourself:**
```bash
cd /home/bosun/agentforge/contracts/budget-guardian
./deploy.sh
```

> Note: `stellar contract build` can take 1–3 minutes on first run (downloads Rust dependencies and compiles to wasm32).

---

## Orchestrator Client: `packages/orchestrator/src/budget-contract.ts`

Typed TypeScript wrapper around the Soroban contract. All USDC↔stroops conversion is internal.

**Graceful degradation:** If `BUDGET_CONTRACT_ID` is unset or is the placeholder `C...`, all functions are no-ops returning safe defaults. Tasks run without on-chain enforcement — nothing breaks, just no contract calls.

**Functions:**

```typescript
createTaskBudget(budgetUsdc: number): Promise<number | null>
// Creates on-chain task, returns contract task_id or null

approveSpend(taskId: number | null, amountUsdc: number): Promise<boolean>
// Returns true=approved, false=denied. Fail-open on contract error.

completeTask(taskId: number | null): Promise<void>
// Marks task done on-chain

getRemaining(taskId: number | null): Promise<number | null>
// Returns remaining USDC or null

getTask(taskId: number | null): Promise<{ budget, spent, remaining, num_payments, completed } | null>
```

**Fail-open policy:** If the contract RPC call fails (network error, etc.), `approveSpend` returns `true` — payments are not blocked by infrastructure failures. The on-chain enforcement is a guardrail, not a hard dependency.

---

## Orchestrator Server Integration (`server.ts`)

New step added to `runTask()` between plan approval and execution:

```
waitForApproval()     → plan_approval_required / plan_approved
createTaskBudget()    → budget_locked broadcast          ← NEW
executor.execute()    → step_* events (with approveSpend per step)  ← NEW
contractCompleteTask() → budget_finalized broadcast      ← NEW
```

**New WebSocket events:**

| Event | When | Data |
|---|---|---|
| `budget_locked` | After approval, before execution | `contract_task_id`, `budget_usdc`, `contract_id`, `explorer_url` |
| `budget_approved` | Before each step payment | `agent_name`, `amount`, `contract_task_id` |
| `budget_denied` | When spend would exceed budget | `agent_name`, `amount` → step fails |
| `budget_finalized` | After task completes | `contract_task_id`, `total_spent`, `explorer_url` |

---

## Executor Integration (`executor.ts`)

`PlanExecutor` now accepts `contractTaskId: number | null` as a constructor argument.

Before every payment (x402 or MPP), calls `approveSpend(contractTaskId, agent.price_per_call)`:
- Returns `true` → payment proceeds, emits `budget_approved`
- Returns `false` → step fails with error "Budget denied by Soroban contract: $X would exceed task budget", emits `budget_denied` then `step_failed`

---

## Dashboard: `BudgetGuardian` Component

Added to the right column below `WalletPanel`, above `PaymentFeed`.

**Shows when contract is active (after `budget_locked` event):**
- Contract task ID + link to stellar.expert contract page
- Budget progress bar (green → yellow → red as budget fills)
- Per-step approval list with agent name and amount
- "Budget finalized on-chain" badge after task completes

**Shows when contract inactive:**
- Greyed out placeholder with deployment instructions

**ActivityFeed additions:**

| Event | Icon | Detail shown |
|---|---|---|
| `budget_locked` | 🛡 purple | `"task #1 · $1.00 locked on-chain"` |
| `budget_approved` | 🛡 green | `"StellarOracle · $0.020 approved"` |
| `budget_denied` | 🛡 red | `"AgentName · $0.020 DENIED — over budget"` |
| `budget_finalized` | 🛡 grey | `"task #1 finalized · $0.0500 spent"` |

---

## Deploying the Contract

> **You need to run this yourself** (compilation takes 1–3 minutes):

```bash
cd /home/bosun/agentforge/contracts/budget-guardian
./deploy.sh
```

After it completes:
1. The script auto-updates `.env` with `BUDGET_CONTRACT_ID=C...`
2. Restart the orchestrator to pick up the new env var:
   ```bash
   ./scripts/stop.sh
   ./scripts/start.sh --no-build
   ```
3. Submit a task — you'll see `Budget Guardian` panel appear in the dashboard with live spend tracking

**Verify on-chain:**
```bash
# Check contract on stellar.expert
open https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>

# CLI verification
stellar contract invoke --id <CONTRACT_ID> --network testnet --source orchestrator \
  -- task_count
```

---

## Files Changed / Created

| File | Change |
|---|---|
| `contracts/budget-guardian/Cargo.toml` | New — Rust package for Soroban contract |
| `contracts/budget-guardian/src/lib.rs` | New — BudgetGuardian contract implementation |
| `contracts/budget-guardian/deploy.sh` | New — automated build/deploy/init/verify script |
| `packages/orchestrator/src/budget-contract.ts` | New — TypeScript client with graceful degradation |
| `packages/orchestrator/src/server.ts` | Added `createTaskBudget` + `completeTask` calls, new WS events |
| `packages/orchestrator/src/executor.ts` | Added `contractTaskId` param, `approveSpend` before each payment |
| `packages/dashboard/src/components/BudgetGuardian.tsx` | New — on-chain budget tracking panel |
| `packages/dashboard/src/components/ActivityFeed.tsx` | 4 new budget event types |
| `packages/dashboard/src/App.tsx` | Added `BudgetGuardian` to right column |
