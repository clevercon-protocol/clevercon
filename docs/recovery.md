# Crash-Safe, Resumable Executor & Exactly-Once Agent Payment

The orchestrator execution engine (`packages/orchestrator/src/executor.ts` & `task-execution-store.ts`) provides crash-safe, durable, and resumable execution of multi-step AI agent workflows with exactly-once on-chain payment settlement.

## Problem Context

When executing a multi-step task moving real USDC per step across agents, a process crash, redeployment, or network timeout could leave execution state ambiguous:
- Did the agent execute?
- Was on-chain payment released?
- What was the intermediate output needed by dependent downstream steps?

Without durable step tracking and on-chain reconciliation, a restart could result in double-paying agents, re-executing already-completed steps, or losing intermediate pipeline state.

---

## Step State Machine

Each step within an `ExecutionPlan` progresses through a strictly defined state machine, persisted durably to `data/task-executions.json` using atomic file writes (`writeJsonSafe`) before and after every external side effect:

```
                  ┌───────────────┐
                  │    pending    │
                  └───────┬───────┘
                          │ (about to invoke agent / health)
                          ▼
                  ┌───────────────┐
            ┌────►│   executing   ├────┐
            │     └───────┬───────┘    │
 (retry on  │             │            │ (health/agent error)
  restart)  │             ▼            │
            │     ┌───────────────┐    │
            └─────┤   delivered   │    │
                  └───────┬───────┘    │
                          │            │
                          ▼            │
                  ┌───────────────┐    │
                  │   releasing   │    │
                  └───────┬───────┘    │
                          │            │
                          ▼            │
                  ┌───────────────┐    │
                  │   released    │    ▼
                  └───────────────┘ ┌──────────────┐
                                    │    failed    │
                                    └──────────────┘
```

### State Definitions

| State | Definition | Durable Write Point |
|---|---|---|
| `pending` | Step scheduled in plan; has not started execution. | Written on task initialization (`initTaskExecution`). |
| `executing` | Agent health check passed; agent endpoint call in-flight. | Written **before** invoking the agent API (`makeX402Payment` / `makeMPPPayment`). |
| `delivered` | Agent returned valid execution output and tx hash. | Written **immediately upon receiving agent response**, before any vault release. |
| `releasing` | On-chain vault release in-flight (contract → orchestrator). | Written **before** invoking on-chain `releasePayment`. |
| `released` | Step output recorded and on-chain payment confirmed/settled. | Written **after** on-chain `releasePayment` confirms. |
| `failed` | Step failed (unreachable agent, unresolvable vault error). | Written on catch blocks with error reason and latency. |

---

## Crash-Point Recovery Matrix

| Crash Scenario | State at Restart | Recovery Action | Payment Invariant |
|---|---|---|---|
| **Crash before agent call** | `pending` or `executing` | Agent was not completed. Re-executes step and proceeds through state machine. | Exactly-once payment |
| **Crash after agent delivery before release** | `delivered` | Re-uses stored output; skips calling agent again. Proceeds directly to vault release. | Exactly-once payment; zero duplicate agent invocations |
| **Crash during on-chain release (ambiguous)** | `releasing` | Reconciles against on-chain AgentVault. Contract's idempotent step release (`release_payment`) returns `Ok(true)` without double-debiting. Transitions to `released`. | Exactly-once payment |
| **Crash after local write before next step** | `released` | Reads stored `output` and `payment`. Skips Step 1 completely; feeds output into dependent Step 2. | Zero duplicate payment; seamless pipeline resumption |
| **User cancelled task on-chain while offline** | `running` | On startup, `getTask(vaultTaskId)` detects `completed: true`. Halts remaining steps immediately and marks task `cancelled`. | Zero unauthorized post-cancellation releases |
| **Repeated recovery runs** | `completed` / `running` | Idempotent: finished tasks are ignored; in-flight tasks resume safely. | Safe to run repeatedly |

---

## Startup Resumption Flow

1. On server boot (`server.ts`), `recoverUnfinishedTasks()` scans `data/task-executions.json` for tasks in `running` or `pending` status.
2. For each task:
   - Resolves the user's orchestrator keypair from `data/orchestrators.json`.
   - Checks on-chain task status via `getTask(vaultTaskId)`.
   - Builds dependency levels (`buildDependencyLevels`).
   - Resumes steps concurrently per level via `Promise.all`:
     - Already `released` steps are skipped.
     - `delivered` steps proceed directly to release.
     - Ambiguous `releasing` steps are reconciled with the vault.
     - Unfinished steps are executed.
3. Upon task completion, remaining locked budget is finalized back to the user (`completeTask`) and final results are saved to `data/task-results.json`.

---

## API Endpoints

- `POST /api/tasks/recover` — Manually triggers recovery and resumption of all unfinished tasks.
- `GET /api/tasks/history/:user_address` — View completed task executions.
- `POST /api/tasks` — Submit new task for execution.

---

## Data Files

- `data/task-executions.json` — Durable per-task and per-step execution state.
- `data/task-results.json` — Persisted completed task history for user dashboard.
