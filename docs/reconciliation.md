# Vault Reconciliation

> **Legacy (earlier hackathon stack).** This describes the `packages/orchestrator`
> JSON-ledger reconciliation and `contracts/budget-guardian`, neither of which is
> part of the production stack. There the on-chain vault is the sole source of truth
> and the balance mirror the API serves is derived directly from CleverVault events
> by `services/indexer` (a resumable cursor), so there is no off-chain ledger to
> reconcile. A production-grade reconciliation/monitoring pass over the indexer
> mirror is a future ops item (see [ROADMAP.md](../ROADMAP.md)). Kept for history.

`packages/orchestrator/src/reconciliation.ts` reconciles the off-chain vault
ledger (`vault-ledger.ts`) against the on-chain AgentVault contract, which is
treated as the source of truth.

## Scope

This worker reconciles **account-level** state only: a user's `balance` and
`total_spent` as reported by `getAccount()`, compared against the sum of
their local ledger entries (deposits, withdrawals, payments).

**Not covered:** task-level reconciliation against BudgetGuardian's
`getTask()`. BudgetGuardian is a separate contract that is not currently
wired into the live task pipeline (`server.ts` only calls
`agent-vault-client.ts` for `createTask`/`releasePayment`/`completeTask`), so
there's no live `vault_task_id` -> BudgetGuardian mapping to reconcile yet.
See the diff-model discussion on issue #105 for the two-pass design this
was scoped from.

## How it works

- **Dry-run (default):** `GET /reconciliation` computes a drift report and
  changes nothing.
- **Repair:** `GET /reconciliation?repair=true` additionally appends a
  corrective `adjustment` entry to the local ledger for any user with
  balance drift, and writes an audit record for every field changed.
- **Idempotent:** running repair twice in a row with no new drift makes no
  further changes (the second run finds `local === chain` and does nothing).
- **Never writes on-chain.** The chain is read-only input; only the local
  ledger and the audit log are ever modified.

## Drift classes

| Type | Meaning |
|---|---|
| `balance_mismatch` | Local derived balance (deposits - withdrawals - payments) differs from chain `balance` |
| `spent_mismatch` | Local summed `payment` entries differ from chain `total_spent` |

`budget_lock` ledger entries are informational only (they represent an
in-flight lock, not a settled movement) and are excluded from both totals,
mirroring how the chain's `balance`/`total_spent` only reflect settled
activity.

All comparisons are done in stroops (fixed-point), not floating-point USDC,
to avoid false-positive drift from rounding.

## Endpoints

- `GET /reconciliation` -- run a dry-run pass, return the full drift report.
- `GET /reconciliation?repair=true` -- run and apply repairs.
- `GET /reconciliation/audit` -- full append-only audit trail.
- `GET /reconciliation/audit?user_address=...` -- audit trail for one user.
- `GET /metrics` -- now includes a `reconciliation` block: `last_run`,
  `last_mode`, `drift_count`, `repaired_count`.

## Data files

- `data/reconciliation-audit.json` -- append-only audit log. Never
  overwritten; only ever appended to.