# Phase 10: React Dashboard + Bug Fixes

## Summary
Built and shipped the React dashboard that visualises the full agent pipeline in real-time. Fixed three cross-cutting bugs discovered during integration testing: a Stellar SDK version mismatch that broke MPP payments, stale processes running on the wrong Node.js version, and intermittent xlm402.com payment failures.

---

## Dashboard — Files Created

### `packages/dashboard/` (new package)
Vite 5 + React 19 + TypeScript + Tailwind CSS v3 app. Builds to `packages/orchestrator/public/` and is served as static files by the orchestrator's Express server.

| File | Purpose |
|------|---------|
| `package.json` | `vite ^5.4.0`, `@vitejs/plugin-react ^4.3.0`, `react ^19.2.4`, `tailwindcss ^3.4.19` |
| `vite.config.ts` | `outDir: ../../packages/orchestrator/public`, dev proxy `/api`→3000, `/ws`→ws://3000 |
| `tailwind.config.js` | Dark theme, content path covers `src/**` |
| `src/index.css` | Tailwind directives + dark base styles + `.prose` markdown styles |
| `src/App.tsx` | 3-tab layout: Dashboard / Earnings / Register Agent |
| `src/hooks/useWebSocket.ts` | Auto-reconnect WebSocket hook, stores up to 200 events |
| `src/hooks/useWallets.ts` | Polls Horizon every 5 s for USDC + XLM balances |
| `src/lib/api.ts` | `submitTask`, `fetchAgents`, `fetchWallets`, `registerAgent` |
| `src/components/TaskInput.tsx` | Textarea + budget slider + submit + example tasks |
| `src/components/AgentPanel.tsx` | Agent list with reputation score badge (green/yellow/red), capabilities, 15 s poll |
| `src/components/ActivityFeed.tsx` | Real-time event log, icon per event type, formatted detail strings |
| `src/components/PaymentFeed.tsx` | Payment entries from `step_complete` + `task_result` events with stellar.expert links |
| `src/components/WalletPanel.tsx` | Live USDC/XLM balances from `useWallets`, stellar.expert links |
| `src/components/ResultPanel.tsx` | Task result with markdown→HTML, step breakdown, tx links |
| `src/components/ReceiptPanel.tsx` | Payment receipt summary: total cost, per-step amounts |
| `src/components/RegisterAgent.tsx` | Agent registration form (POST to registry) |
| `src/components/EarningsView.tsx` | Leaderboard sorted by `successful_jobs × price_per_call` with bar chart |

### `packages/orchestrator/src/server.ts` — additions
Added static file serving so the dashboard is available at `http://localhost:3000`:
```typescript
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(__dirname, '..', 'public');
app.use(express.static(dashboardPath));
app.get('/', (_req, res) => res.sendFile(path.join(dashboardPath, 'index.html'), ...));
```

---

## Build Fix — `@vitejs/plugin-react` Version

### Problem
`npm run build` failed in `packages/dashboard`:
```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './internal' is not defined
```
Root cause: `@vitejs/plugin-react@6.0.1` (installed) requires `vite ^8.0.0`, but Vite 8 requires Node ≥ 20.19.0. System is Node 20.18.0.

### Fix
Downgraded `@vitejs/plugin-react` to `^4.3.0` (compatible with Vite 5) in both root and dashboard `package.json`. Also added `vite ^5.4.0` and `@vitejs/plugin-react ^4.3.0` to root `devDependencies` to resolve workspace hoisting — root-hoisted `@vitejs/plugin-react` now finds `vite` at the root level.

---

## Bug Fix 1 — MPP Payments Failing (`Bad union switch: 4`)

### Symptom
AnalysisBot step always failed with:
```
SettlementError: [stellar:charge] Settlement failed: transaction not confirmed.
details: { hash: '686db16c...', details: 'Bad union switch: 4' }
```
The MPP payment transaction submitted successfully but the SDK crashed parsing the Soroban poll response.

### Root Cause
`@stellar/stellar-sdk@12.3.0` was installed at root, but `@stellar/mpp@0.3.0` declares `peerDependencies: { "@stellar/stellar-sdk": "^14.6.1" }`. Stellar testnet is on **protocol 26** which uses XDR enum values not recognised by sdk 12.x, causing `Bad union switch: 4` during `getTransaction()` polling.

### Fix
```bash
npm install @stellar/stellar-sdk@^14.6.1 --legacy-peer-deps
```
`@stellar/stellar-sdk@14.6.1` is now installed at root. Added to root `package.json` as a production dependency.

### Verification
```
makeMPPPayment('http://localhost:4004/analyze', ...) → Status: 200, analysis output received
```

---

## Bug Fix 2 — Wrong Node.js Version on All Processes

### Symptom
After restarting the orchestrator (and later reporter/webintelv2), those processes ran under **Node v23.8.0** instead of v20.18.0. x402 payments to the reporter returned `402: {}` — the `ExactStellarScheme` built transactions against the wrong runtime and the facilitator rejected them.

### Root Cause
Process restart commands used `source ~/.nvm/nvm.sh` without `nvm use 20`, defaulting to the shell's active version (v23). The old orchestrator had also been started this way earlier in the session.

### Fix
All restart commands now explicitly call:
```bash
source ~/.nvm/nvm.sh && nvm use 20 && ...
/home/bosun/agentforge/node_modules/.bin/tsx ...
```

Affected processes restarted on Node 20.18.0:
- Orchestrator (`packages/orchestrator/src/server.ts`)
- ReporterBot (`packages/agents/reporter/src/server.ts`)
- WebIntelligenceV2 (`packages/agents/web-intel-v2/src/server.ts`)
- AnalysisBot (`packages/agents/analysis/src/server.ts`)

---

## Bug Fix 3 — xlm402.com Intermittent 402 (Sponsored Fee Race)

### Symptom
`WebIntelligenceV2` step failed intermittently:
```
[WebIntelligenceV2] Query error: xlm402 news failed: 402
```
xlm402.com returns 402 even after `wrapFetchWithPaymentFromConfig` paid, because xlm402.com uses `areFeesSponsored: true` — the server broadcasts the signed transaction, and sometimes the broadcast/confirmation is too slow for the verification check.

### Fix
Added 3-attempt retry loop with backoff in `packages/agents/web-intel-v2/src/news.ts`. A fresh `ExactStellarScheme` is created on each attempt to avoid stale sequence-number state:
```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  const signer = createEd25519Signer(SECRET_KEY);
  const scheme = new ExactStellarScheme(signer);
  const payingFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [...] });
  try {
    const response = await payingFetch(...);
    if (!response.ok) throw new Error(`xlm402 news failed: ${response.status}`);
    return { data: await response.json(), paid: true };
  } catch (err) {
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    else throw err;
  }
}
```

---

## End-to-End Verification

### Dashboard served at `http://localhost:3000`
- Static assets: `index.html`, `assets/index-*.js`, `assets/index-*.css`
- `/api/agents` → 5 agents listed
- `/health` → `{"status":"ok","agent":"Orchestrator"}`
- `WS /ws` → real-time events visible in ActivityFeed

### Full 4-step pipeline — first `complete` run
```
Task: "stellar news and XLM market analysis with full report"
Status: complete
Cost:   $0.0500 USDC
Time:   101,438ms
```

| Step | Agent | Payment | TX Hash |
|------|-------|---------|---------|
| 1 (parallel) | StellarOracle | x402 $0.02 | `1a8714ba...` |
| 1 (parallel) | WebIntelligenceV2 | x402 $0.015 | — |
| 2 | AnalysisBot | MPP $0.005 | — |
| 3 | ReporterBot | x402 $0.02 | `78fc2b0c...` |

### Previous partial runs (before fixes)
| Task | Status | Cost | Root Cause |
|------|--------|------|------------|
| "give me news on stellar…" | partial | $0.020 | Node 23 orchestrator + sdk 12 MPP |
| "what's going on with stellar…" | partial | $0.025 | Stale Anthropic key (reporter 401), MPP sdk mismatch |
| "stellar news and XLM market…" | partial | $0.035 | Node 23 reporter |

---

## Key Learnings

- **npm workspace hoisting**: putting `vite` + `@vitejs/plugin-react` at the root alongside the dashboard package resolves peer-dep resolution for hoisted packages.
- **`@stellar/stellar-sdk` versions matter**: SDK 12.x can't parse Soroban protocol 26 XDR. Always check `peerDependencies` of packages that touch Soroban RPC.
- **Always pin Node version explicitly** (`nvm use 20`) when restarting processes — never rely on the shell default.
- **`areFeesSponsored` x402 payments are inherently async** — the server-side facilitator broadcasts and confirms the tx. Add retry logic for sponsored payment endpoints.
- **`Bad union switch: N`** in Stellar SDK = XDR protocol mismatch. Fix: upgrade `@stellar/stellar-sdk`.
