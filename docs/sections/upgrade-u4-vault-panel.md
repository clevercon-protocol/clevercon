# Upgrade Phase U4 — Vault Panel (Deposit, Withdraw, Live Balance)

## Summary

Users can now see their AgentVault USDC balance, deposit from Freighter, and withdraw back. The VaultPanel sits at the top of the right column in the dashboard and polls the contract every 8 seconds for live updates. Fund and Withdraw flows use Freighter signing, matching the U3 pattern.

---

## Files Created / Modified

| File | Change |
|---|---|
| `packages/orchestrator/src/agent-vault-client.ts` | Added `getAccount()` + `VaultAccount` interface |
| `packages/orchestrator/src/server.ts` | Added 4 vault endpoints |
| `packages/dashboard/src/lib/vault-client.ts` | **NEW** — frontend API client |
| `packages/dashboard/src/components/VaultPanel.tsx` | **NEW** — vault UI with inline modals |
| `packages/dashboard/src/App.tsx` | Added `VaultPanel` to right column |

---

## Backend

### New endpoints

```
GET  /api/vault/account/:user_address
  → { balance, available, locked, total_deposited, total_spent, active_tasks_count }
  All amounts in USDC (decimal). Returns zeros if no vault account yet.

POST /api/vault/deposit-xdr
  Body: { user_address, amount }
  → { xdr: string }  unsigned deposit XDR for Freighter to sign

POST /api/vault/withdraw-xdr
  Body: { user_address, amount }
  → { xdr: string }  unsigned withdraw XDR for Freighter to sign

POST /api/vault/submit
  Body: { signed_xdr }
  → { success: true, tx_hash }  polls for confirmation via Soroban RPC
```

### `getAccount()` in agent-vault-client.ts

Calls `get_account` view on AgentVault contract, unwraps the `Option<UserAccount>` ScVal and returns a typed `VaultAccount` object with all amounts in USDC decimal.

---

## Frontend

### `vault-client.ts`

Thin API client over the four backend endpoints. No Stellar SDK in the browser — keeps the bundle small.

### `VaultPanel.tsx`

- Polls `GET /api/vault/account/:addr` every 8s for live balance
- Shows: total balance, available, locked (with amber warning), lifetime spent
- **Fund flow**: quick-amount buttons ($1/$5/$10/$20) + custom input → build XDR → Freighter sign → submit → success with stellar.expert tx link
- **Withdraw flow**: same pattern, amount capped at `available`, disabled if `active_tasks_count > 0`
- Contract link to stellar.expert in panel header
- Shared `VaultModal` component handles both Fund and Withdraw states: `idle → building → signing → submitting → success/error`

---

## Key Design Decisions

- **Backend proxy for XDR building** — Soroban simulation runs server-side (avoids bundling stellar-sdk in the browser and handles CORS with Soroban RPC).
- **8-second polling** — fast enough to show balance updates promptly after a deposit/withdraw without excessive RPC traffic.
- **Withdraw disabled during active tasks** — mirrors the contract safety check (`active_tasks_count == 0`), providing early UX feedback.
- **Inline modals** — Fund and Withdraw modals live inside `VaultPanel.tsx` as a shared `VaultModal` component rather than separate files, since they share 90% of the same structure.

---

## Verification Checklist

- [ ] VaultPanel shows "0.00 USDC" for a fresh account
- [ ] Click Fund → modal opens with $1/$5/$10/$20 quick buttons
- [ ] Enter amount → click Deposit → Freighter popup → sign → success with tx link
- [ ] Balance updates to reflect deposit (within 8s or immediately on close)
- [ ] stellar.expert shows USDC moved from your wallet to the contract
- [ ] Click Withdraw → enter amount → sign → balance decreases
- [ ] Withdraw button disabled when `active_tasks_count > 0`
- [ ] Withdraw button disabled when balance = 0
- [ ] Entering more than available shows inline error
