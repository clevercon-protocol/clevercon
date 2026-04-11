# Upgrade Phase U3 — Orchestrator Creation & Naming

## Summary

After a user connects their Freighter wallet (U2), they are now directed to a
"Create your AI agent" screen if they don't have a personal orchestrator yet.
They choose a name (e.g., Phoenix), the backend generates a dedicated Stellar
keypair, funds it with XLM via Friendbot, and stores the record. If the
AgentVault contract is deployed (`AGENT_VAULT_CONTRACT_ID` set), the user
also signs an on-chain `register_orchestrator` transaction in Freighter.

---

## App flow after U3

```
Visit localhost:3000
  └── WalletProvider (U2)
       └── OrchestratorProvider (U3)
            └── AppInner
                 ├── isLoading         → spinner
                 ├── !isConnected      → <ConnectWallet />     (U2)
                 ├── !orchestrator     → <CreateOrchestrator /> (U3)
                 └── orchestrator set  → <Dashboard />
```

---

## Files Created / Modified

| File | Change |
|---|---|
| `packages/orchestrator/src/orchestrator-store.ts` | **NEW** — JSON persistence for orchestrator records |
| `packages/orchestrator/src/agent-vault-client.ts` | **NEW** — Soroban client for AgentVault contract (U3–U5) |
| `packages/orchestrator/src/server.ts` | Added 3 endpoints + `orchestratorStore` import |
| `packages/dashboard/src/contexts/OrchestratorProvider.tsx` | **NEW** — React context |
| `packages/dashboard/src/components/CreateOrchestrator.tsx` | **NEW** — naming UI |
| `packages/dashboard/src/App.tsx` | Wrapped in `OrchestratorProvider`; gate on `!orchestrator` |

---

## Backend

### `orchestrator-store.ts`

Persists records to `data/orchestrators.json` (keyed by `user_address`).
In-memory cache is invalidated on every write.

```typescript
interface OrchestratorRecord {
  user_address: string;           // Freighter public key
  orchestrator_name: string;      // "Phoenix"
  orchestrator_pubkey: string;    // Generated Stellar pubkey
  orchestrator_secret: string;    // Stored plaintext (hackathon only)
  system_prompt?: string;
  registered_on_chain: boolean;
  created_at: string;
}
```

### `agent-vault-client.ts`

Full Soroban client for the AgentVault contract, following the same
simulate → assemble → sign → submit → poll pattern as `budget-contract.ts`.

Gracefully no-ops when `AGENT_VAULT_CONTRACT_ID` is not set (prints a warning).
All functions return `null`/`false`/`0n` as safe defaults in that case.

Functions provided:
- `buildRegisterOrchestratorXdr(user, orch, name)` → unsigned XDR (U3)
- `buildDepositXdr(user, amount)` → unsigned XDR (U4)
- `buildWithdrawXdr(user, amount)` → unsigned XDR (U4)
- `createTask(orchKeypair, planCost)` → task_id bigint (U5)
- `releasePayment(orchKeypair, taskId, amount)` → boolean (U5)
- `completeTask(orchKeypair, taskId)` → void (U5)
- `getBalance(userAddress)` → bigint stroops (U4)
- `getAvailable(userAddress)` → bigint stroops (U4)
- `submitSignedXdr(signedXdr)` → tx hash

### New API endpoints

```
GET  /api/orchestrators/:user_address
  → { exists: false }
  → { exists: true, name, pubkey, registered_on_chain, system_prompt }

POST /api/orchestrators
  Body: { user_address, name, system_prompt? }
  Steps:
    1. 409 if record already exists
    2. Keypair.random() → fresh Stellar keypair
    3. Friendbot fund (Horizon testnet)
    4. Store in orchestrators.json
    5. If AGENT_VAULT_CONTRACT_ID set → buildRegisterOrchestratorXdr
  → { orchestrator_pubkey, name, registration_xdr: string | null }

POST /api/orchestrators/confirm
  Body: { user_address, signed_xdr }
  Steps:
    1. submitSignedXdr(signed_xdr) → tx_hash
    2. markRegisteredOnChain(user_address)
  → { success: true, tx_hash }
```

---

## Frontend

### `OrchestratorProvider`

Fetches `GET /api/orchestrators/:pubkey` on mount (and after creation).
Exposes `orchestrator | null`, `isLoading`, `refresh()`.

### `CreateOrchestrator`

- Name input with quick-pick buttons (Phoenix, Atlas, Sage, Nova…)
- Optional personality textarea (collapsed by default)
- **Step 1** (`creating`): POST `/api/orchestrators` → generates keypair + Friendbot
- **Step 2** (`signing`, only if `registration_xdr` returned): Freighter popup
- **Step 3**: POST `/api/orchestrators/confirm` → on-chain confirmation
- **Success screen**: orchestrator name + stellar.expert link + "Redirecting…"
- After success: `refresh()` → `OrchestratorProvider` updates → `AppInner` transitions to Dashboard

### Contract registration is optional

If `AGENT_VAULT_CONTRACT_ID` is not set in `.env`, `registration_xdr` is `null`
and the signing step is skipped entirely. The orchestrator exists locally and
works for all U3 and task-execution flows. On-chain registration is added when
the contract is deployed (U1/U5).

---

## Verification Checklist

- [x] `GET /api/orchestrators/GTEST` → `{ exists: false }`
- [x] Dashboard build succeeds (278KB single chunk)
- [x] Orchestrator server restarts cleanly with new endpoints
- [ ] Hard-reload → wallet connect → CreateOrchestrator screen appears
- [ ] Type a name, click Create → spinner → success screen with stellar.expert link
- [ ] Refresh after creation → goes straight to Dashboard (no re-creation)
- [ ] `data/orchestrators.json` contains the entry
- [ ] Stellar.expert shows the new orchestrator wallet with XLM balance
- [ ] 409 returned if same user tries to create again

---

## Key Design Decisions

- **One orchestrator per user, forever.** The `OrchestratorOwner` mapping in the
  contract is immutable. The backend enforces 409 on duplicate creation.
- **tsx for development, dist/server.js for production.** Since the orchestrator
  package has no `build` script, new source files (orchestrator-store.ts,
  agent-vault-client.ts) are compiled on-the-fly by tsx in dev mode. For
  production builds, add `tsc` as a build script in `packages/orchestrator/package.json`.
- **Secret stored plaintext for hackathon.** In production: encrypt with user's
  pubkey or use a KMS.
- **`__dirname` from `process.argv[1]`** — the existing orchestrator pattern for
  ESM compatibility; `orchestrator-store.ts` follows the same approach.
