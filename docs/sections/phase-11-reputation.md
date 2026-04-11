# Phase 11 — Reputation & Selection Visibility

## Goal

Surface the agent scoring algorithm in real-time: broadcast per-agent scores on every task, expose per-step selection reasoning ("Selected X over Y"), and add a human-in-the-loop plan approval gate before any payments are made.

---

## What Was Built

### 1. `scripts/start.sh` + `scripts/stop.sh`

Bash scripts for one-command local development setup.

**`scripts/start.sh`** — ordered startup with health checks:
1. Sources `.env` (fails gracefully if missing)
2. Pins Node 20 via `nvm use 20`
3. Optionally builds the dashboard (`--no-build` to skip)
4. Starts **Registry** → waits for `/health`
5. Starts **4 agents** in parallel (stellar-oracle, web-intel-v2, analysis, reporter)
6. Runs **bootstrap** to register agents with registry (`--no-bootstrap` to skip)
7. Starts **Orchestrator** → waits for `/health`
8. Prints URLs

Key design decisions:
- Kills stale PID-file processes before restarting (handles dirty shutdown)
- Each service subprocess re-sources nvm to ensure Node 20 regardless of shell default
- Uses `$REPO_DIR/logs/<name>.log` and `<name>.pid` for tracking

**`scripts/stop.sh`** — reads PID files and kills processes, then scans ports 3000–4005 for orphans via `lsof`.

Usage:
```bash
./scripts/start.sh             # full start (builds dashboard, runs bootstrap)
./scripts/start.sh --no-build  # skip dashboard build
./scripts/stop.sh              # stop everything
```

---

### 2. Orchestrator: Agent Scoring Broadcast (`agents_scored`)

**File:** `packages/orchestrator/src/server.ts`

After agents are fetched, `scoreAgents()` is called immediately and results broadcast:

```
WS event: agents_scored
{
  task_id: "...",
  agents: [
    {
      agent_id, name, score,
      breakdown: { capability_match, reputation, price_efficiency, latency_score, discovery_bonus },
      reputation_score,
      price_per_call
    }, ...
  ]  // sorted best → worst
}
```

Scoring weights (from spec Section 10):
| Factor | Weight |
|---|---|
| Capability match | 35% |
| Reputation score | 30% |
| Price efficiency | 15% |
| Latency | 10% |
| Discovery bonus | 10% |

---

### 3. Orchestrator: Per-Step Selection Reasoning

**File:** `packages/orchestrator/src/server.ts`

After the plan is validated, each step is enriched with selection reasoning before the approval broadcast. For each step:

1. Identifies the planned agent's capabilities as the `neededCapabilities`
2. Runs `scoreAgents()` across all agents
3. Finds the planned agent's rank and score
4. Captures the top 2 alternative agents

```
WS event: plan_created
{
  task_id, steps, total_estimated_cost, reasoning,
  step_selections: [
    {
      step_id, agent_id, agent_name, action, payment_method, estimated_cost,
      selected_score: 0.82,
      selected_rank: 1,
      total_candidates: 4,
      score_breakdown: { capability_match, reputation, price_efficiency, latency_score, discovery_bonus },
      alternatives: [
        { agent_id, name, score: 0.61 },
        { agent_id, name, score: 0.44 }
      ]
    }, ...
  ]
}
```

---

### 4. Orchestrator: Plan Approval Gate

**File:** `packages/orchestrator/src/server.ts`

Execution is paused after plan validation, awaiting explicit user approval.

**Flow:**
```
runTask()
  ├── fetchAgents()      → agents_loaded
  ├── scoreAgents()      → agents_scored
  ├── checkFeasibility() → feasibility_checked
  ├── createPlan()       → plan_created (with step_selections)
  ├── validatePlan()     → plan_validated
  ├── waitForApproval()  → plan_approval_required   ← PAUSE HERE
  │     ├── user POSTs /api/tasks/:id/approve → plan_approved
  │     ├── user POSTs /api/tasks/:id/reject  → plan_rejected (task cancelled)
  │     └── 60s timeout                       → plan_auto_approved
  └── executor.execute() → task_started / step_* / task_complete
```

**New HTTP endpoints:**
- `POST /api/tasks/:id/approve` — resolves pending gate, execution proceeds
- `POST /api/tasks/:id/reject` — rejects gate, task cancelled with error event

**Auto-approval timeout:** Configurable via `PLAN_APPROVAL_TIMEOUT_MS` env var (default: 60 seconds). Prevents tasks from hanging forever if the dashboard is unattended.

**`pendingApprovals` map** — stores `{ resolve, reject, timer }` per task_id. Cleared on approve, reject, or timeout.

---

### 5. Dashboard: `PlanApproval` Component

**File:** `packages/dashboard/src/components/PlanApproval.tsx`

Full-screen modal overlay that appears when `plan_approval_required` event is received.

**Layout:**
- Header: task description, reasoning, total estimated cost
- Countdown bar: shows seconds remaining until auto-approval
- Step list: each step is an expandable card showing:
  - Agent name + score (color-coded: green ≥70, yellow ≥40, red <40)
  - "vs AlternativeAgent (62), AnotherAgent (44)" — selection reasoning inline
  - Expanded view: full score breakdown bars (5 factors) + alternatives table
- Footer: Reject (grey) + Approve & Execute (purple) buttons

**Score colors:**
- `≥ 70` → green (`text-green-400`)
- `≥ 40` → yellow (`text-yellow-400`)
- `< 40` → red (`text-red-400`)

---

### 6. Dashboard: `App.tsx` Updates

- Imports and renders `PlanApproval` as modal overlay
- State: `pendingPlan: PendingPlan | null`
- On `plan_approval_required` event → set `pendingPlan`
- On `plan_approved` / `plan_rejected` / `plan_auto_approved` → clear `pendingPlan`
- Header shows animated `"Plan pending approval"` badge when gate is active

---

### 7. Dashboard: `ActivityFeed` Updates

New event labels and icons:

| Event | Icon | Color |
|---|---|---|
| `agents_scored` | ★ Star | purple-300 |
| `plan_approval_required` | Clock | yellow-400 |
| `plan_approved` | CheckCircle | green-400 |
| `plan_rejected` | XCircle | red-400 |
| `plan_auto_approved` | CheckCircle | gray-400 |

Inline detail for `agents_scored`: `"4 agents scored · top: StellarOracle (0.82)"`

---

### 8. `lib/api.ts` Additions

```typescript
export async function approveTask(task_id: string): Promise<any>
export async function rejectTask(task_id: string):  Promise<any>
```

---

## New Event Flow (Full)

```
task_accepted          → task received, task_id assigned
agents_loaded          → N agents fetched from registry
agents_scored          → all agents ranked with score breakdown
feasibility_checked    → can the agents handle this task?
plan_created           → plan with per-step selection reasoning
plan_validated         → budget/agent validation passed
plan_approval_required → 🔔 USER ACTION REQUIRED (or auto in 60s)
plan_approved          → user approved (or auto-approved)
task_started           → executor begins
step_started           → individual agent invoked
step_complete          → agent responded, payment confirmed
task_complete          → all steps done
task_result            → full result object
```

---

## Files Changed / Created

| File | Change |
|---|---|
| `scripts/start.sh` | New — start all services with health checks |
| `scripts/stop.sh` | New — stop all services by PID file |
| `packages/orchestrator/src/server.ts` | Major rewrite — scoring, step reasoning, approval gate, new endpoints |
| `packages/orchestrator/src/executor.ts` | Minor — `execute()` accepts optional `externalTaskId` |
| `packages/dashboard/src/components/PlanApproval.tsx` | New — plan approval modal with scoring breakdown |
| `packages/dashboard/src/components/ActivityFeed.tsx` | Added new event types (icons + labels) |
| `packages/dashboard/src/App.tsx` | Handle `plan_approval_required` event, render PlanApproval |
| `packages/dashboard/src/lib/api.ts` | Added `approveTask()`, `rejectTask()` |

---

## Testing Locally

```bash
# One-command start
./scripts/start.sh

# Open dashboard
open http://localhost:3000

# Submit a task → plan approval modal appears
# Review per-step agent scores and alternatives
# Click "Approve & Execute" to proceed (or wait 60s for auto-approve)

# Stop everything
./scripts/stop.sh
```

**Verifying the scoring broadcast:**
Open browser DevTools → Network → WS → `/ws` connection. After submitting a task, you should see `agents_scored` arrive before `plan_created`, followed by `plan_approval_required` with `steps[].selected_score` and `steps[].alternatives`.
