# Phase 13 — Integration, Bootstrap & Polish

## Goal

Tie the system together end-to-end: agent wallet provisioning during registration, agent removal from the dashboard, a bootstrap script to seed reputation history, and a hackathon-ready README. No new capabilities — this phase ensures everything that was built in phases 1–12 is accessible, well-documented, and immediately demonstrable.

---

## Changes

### 1. Math Agent Removed — `data/registry.json`

A test agent (`agent_id: "12345"`, name `"math"`) was accidentally registered and persisted to the registry. It was removed directly from `data/registry.json`. The registry now contains exactly five core agents:

| agent_id | name |
|---|---|
| `stellar-oracle` | StellarOracle |
| `web-intel-v1` | WebIntelligence |
| `web-intel-v2` | WebIntelligenceV2 |
| `analysis-agent` | AnalysisBot |
| `reporter-agent` | ReporterBot |

---

### 2. Agent Removal — Dashboard + Orchestrator

**Problem:** Agents registered via the dashboard (or accidentally) had no removal path from the UI.

**Solution:** Two-part change — orchestrator proxy endpoint + dashboard UI.

#### `packages/orchestrator/src/server.ts` — new `DELETE /api/agents/:id`

Proxies deletion requests from the dashboard to the registry:

```typescript
app.delete('/api/agents/:id', async (req, res) => {
  const resp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(req.params.id)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
  // 404 / 502 / success forwarded appropriately
  res.json({ deleted: true, agent_id: req.params.id });
});
```

The registry already had `DELETE /agents/:id` from Phase 8. This just exposes it through the orchestrator's same-origin API so the dashboard can call it without CORS issues.

#### `packages/dashboard/src/components/AgentPanel.tsx`

- Added `Trash2` from lucide-react
- Added `CORE_AGENTS` Set — the 5 built-in agents cannot be deleted from the UI:
  ```typescript
  const CORE_AGENTS = new Set(['stellar-oracle', 'web-intel-v1', 'web-intel-v2', 'analysis-agent', 'reporter-agent']);
  ```
- Added `deleting` state (tracks which agent is being deleted) and `confirmId` state (two-step confirm)
- Added `removeAgent(agent_id)` — calls `DELETE /api/agents/:id`, then removes agent from local state optimistically
- Trash icon only rendered for non-core agents
- Two-step confirm flow: click trash → confirm button appears → click confirm → delete. Cancel button dismisses

---

### 3. Wallet Provisioner — `packages/orchestrator/src/wallet-provisioner.ts` (NEW)

New module that provisions a sponsored Stellar agent account for new agents who don't have a wallet.

**Security model:**
- Keypair is generated locally via `Keypair.random()` — the secret key **never leaves the orchestrator process**
- Only the public key is sent to the sponsor service
- The sponsor service builds and funds the transaction; the orchestrator signs with the new keypair and submits

**Safety check:**  
Before signing, the module verifies the transaction has exactly 4 operations:
1. `beginSponsoringFutureReserves`
2. `createAccount`
3. `changeTrust` (USDC trustline)
4. `endSponsoringFutureReserves`

Any other operation count causes a hard rejection: `"Unexpected operation count: N (expected 4). Refusing to sign."`

**Sponsor service:** `https://stellar-sponsored-agent-account.onrender.com`  
Source: https://github.com/oceans404/stellar-sponsored-agent-account

**Returned shape:**
```typescript
interface ProvisionedWallet {
  publicKey: string;   // G... address — safe to share
  secretKey: string;   // S... secret — shown once, never stored
  explorerUrl: string; // stellar.expert link to the new account
  txHash: string;      // Stellar transaction hash for the sponsorship tx
}
```

#### `packages/orchestrator/src/server.ts` — new `POST /api/provision-wallet`

Dynamically imports and calls `provisionAgentWallet()`:

```typescript
app.post('/api/provision-wallet', async (req, res) => {
  const { provisionAgentWallet } = await import('./wallet-provisioner.js');
  const wallet = await provisionAgentWallet();
  res.json(wallet);
});
```

---

### 4. RegisterAgent Dashboard Component — `packages/dashboard/src/components/RegisterAgent.tsx`

Rewrote to add full wallet provisioning support.

**New form field:** `provision_wallet: boolean` (checkbox)

**New state:**
- `status: 'provisioning'` — intermediate state while wallet is being created
- `provisioned: ProvisionedWallet | null` — holds the result to display after success
- `copied: boolean` — clipboard copy feedback

**Form validation update:**
- Stellar address is only validated if `provision_wallet` is `false`
- `canSubmit` allows submission if `provision_wallet` is checked (no address needed)

**Submission flow when `provision_wallet` is checked:**
1. Set status to `'provisioning'`
2. Call `POST /api/provision-wallet`
3. On success: use the returned `publicKey` as the `stellar_address` for registration
4. Continue to registration as normal

**Success screen additions:**
- Displays public key (monospace, copyable)
- Displays secret key in a red-bordered box with label "Secret Key (save this — shown once)"
- Copy-to-clipboard button with "Copied!" feedback
- Link to stellar.expert to view the sponsorship transaction

**Button states:**
- `'Provision Wallet & Register'` — when checkbox ticked
- `'Provisioning wallet...'` — during `status === 'provisioning'`
- `'Registering...'` — during `status === 'loading'`
- `'Register Agent'` — default

---

### 5. Bootstrap Script — `scripts/bootstrap.ts` (NEW)

Runs 25 diverse tasks through the system to build agent reputation history. Designed to be run once after initial setup.

**Usage:**
```bash
npx tsx scripts/bootstrap.ts
npx tsx scripts/bootstrap.ts --auto-approve    # approve plans immediately
npx tsx scripts/bootstrap.ts --delay=5000      # 5s gap between tasks
```

Also available via npm:
```bash
npm run bootstrap
```

**Task distribution (25 tasks):**

| Category | Count | Example |
|---|---|---|
| StellarOracle only | 5 | "What is the current XLM price?" |
| WebIntel only | 5 | "Get the latest blockchain news" |
| Fetch + Analysis | 3 | "Get news and analyse sentiment" |
| Fetch + Analysis + Report | 3 | "Get XLM data + write a market report" |
| Analysis-heavy | 2 | "Compare XLM prices across sources" |
| Reporter-only | 1 | "Summarise AgentForge in one paragraph" |
| Full pipeline | 6 | "Research, analyse, and write a comprehensive briefing" |

**Implementation details:**

- Connects to the orchestrator's WebSocket (`/ws`) to receive real-time events
- Submits tasks via `POST /api/tasks`
- Listens for `plan_approval_required` and auto-approves after a configurable delay (default 10s)
- Waits for `task_complete`, `task_error`, or `task_infeasible` before proceeding
- Safety timeout: 3 minutes per task (prevents hanging)
- Delays 8 seconds between tasks by default (prevents overwhelming services)
- Prints summary table at end: total / complete / error / infeasible counts
- Health-checks the orchestrator before starting; exits with a friendly error if services aren't up

---

### 6. README.md (NEW)

Hackathon-ready project README at the repository root. Covers:

- System overview and purpose
- Architecture diagram (ASCII) + package table
- Payment protocol explanations (x402 and MPP)
- Soroban Budget Guardian description
- Quick-start guide (install → configure → wallets → start → bootstrap → stop)
- Environment variable reference table
- Contract deployment instructions
- How to register a new agent from the dashboard
- Agent selection scoring explanation (5-factor weighted system)
- Dashboard panel guide
- Full project directory structure
- Hackathon track statement with Stellar integration summary

---

## Files Changed / Created

| File | Change |
|---|---|
| `data/registry.json` | Removed test "math" agent |
| `packages/orchestrator/src/server.ts` | Added `DELETE /api/agents/:id` and `POST /api/provision-wallet` endpoints; updated header comment |
| `packages/orchestrator/src/wallet-provisioner.ts` | New — sponsored wallet provisioning with local key generation and 4-op safety check |
| `packages/dashboard/src/components/AgentPanel.tsx` | Added `Trash2` import, `CORE_AGENTS` guard, `removeAgent()`, two-step confirm UI |
| `packages/dashboard/src/components/RegisterAgent.tsx` | Full rewrite — wallet provisioning checkbox, `provision_wallet` form field, success screen with secret key display |
| `scripts/bootstrap.ts` | New — 25-task reputation-seeding script with WebSocket tracking and auto-approve |
| `README.md` | New — hackathon README |

---

## How to Run After Phase 13

```bash
# First time setup (if not done already)
npx tsx scripts/setup-wallets.ts
npx tsx scripts/add-usdc-trustlines.ts
npx tsx scripts/distribute-usdc.ts

# Start everything
./scripts/start.sh

# Seed reputation (optional but recommended)
npm run bootstrap

# Dashboard
open http://localhost:3000
```
