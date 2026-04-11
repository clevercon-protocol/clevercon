# Upgrade Phase U2 — External Wallet Integration

## Goal

Enable users to connect their Freighter wallet to the dashboard. Wallet
connection is required to access the main dashboard. This is the entry point
for all U3–U7 user flows.

This phase is frontend-only. No orchestrator changes. No contract calls yet.

---

## Architecture

```
App
 └── WalletProvider (context)
      └── AppInner
           ├── isLoading=true   → spinner
           ├── isConnected=false → <ConnectWallet />
           └── isConnected=true  → <Dashboard /> (existing layout)
```

---

## Files Changed

| File | Change |
|---|---|
| `packages/dashboard/src/contexts/WalletProvider.tsx` | **Complete rewrite** — direct `@stellar/freighter-api` (no kit modal) |
| `packages/dashboard/src/components/ConnectWallet.tsx` | Updated UX — Freighter-first, warning banner if extension absent |
| `packages/dashboard/src/App.tsx` | `AppInner` now gates on `isConnected`; removed Connect button from header |
| `packages/dashboard/src/main.tsx` | Broadened unhandledrejection suppression filter |
| `packages/dashboard/package.json` | `react` and `react-dom` pinned to exact `19.2.5` |

---

## Problem Diagnosis (Issues Fixed in This Phase)

### React version mismatch — blank page on first load
**Error**: `Minified React error #527; args[]=19.2.5&args[]=19.2.4`

`packages/dashboard/package.json` declared `react@^19.2.5` which resolved to
19.2.5 locally, while root `node_modules/react-dom` was 19.2.4. Two React
instances were bundled, crashing before mount.

**Fix**: pinned both to exact `19.2.5`, deleted stale local copies, re-ran
`npm install --legacy-peer-deps`.

### stellar-wallets-kit modal showed Freighter as "not available"
`FreighterModule.isAvailable()` calls `isConnected()` from
`@stellar/freighter-api`. In v5 this checks `window.freighter`, which browser
extensions inject asynchronously. When the kit opens its modal right after page
load, the window object hasn't been populated yet — so Freighter is falsely
marked unavailable even when the extension is installed.

### MetaMask / "no elements in sequence" errors from kit bundle
`@creit.tech/stellar-wallets-kit@1.9.5` bundles `@walletconnect/modal`, which
probes for EVM wallets at import time. Even without explicitly adding
`WalletConnectModule`, the probing fires as soon as the kit chunk is loaded,
emitting unhandled rejections.

---

## Solution: Direct `@stellar/freighter-api` — No Kit Modal

`@stellar/freighter-api@5.0.0` was already hoisted to the workspace root.
Using it directly eliminates all three issues above.

### Connect flow in `WalletProvider`

1. **`waitForFreighter()`** — polls `isConnected()` up to 6 × 500 ms (3 s total)
   to give the browser extension time to inject into the page.
2. **`requestAccess()`** — triggers the Freighter popup asking for site permission.
3. **`getAddress()`** — fetches the public key.
4. Public key stored in `localStorage` (`agentforge_pubkey`).

### Auto-reconnect

On mount, the stored public key is restored immediately (before the extension poll
completes) so returning users see the dashboard without a flash.

### signTransaction

Delegates to `freighterSign(xdr, { networkPassphrase })` from `@stellar/freighter-api`.
Used by U3 (register orchestrator), U4 (deposit/withdraw), and U6 (cancel task).

---

## Key Decisions

- **No stellar-wallets-kit modal for connection.** The kit is still in
  `package.json` — it may be used for Albedo / multi-wallet support in U7 polish,
  and it provides the `@stellar/freighter-api` peer dep. But all actual connection
  logic uses freighter-api directly.
- **`freighterAvailable` exposed in context** so `ConnectWallet` can show an
  install-link banner when the extension is genuinely absent.
- **Connection happens on the landing page only.** The header no longer has a
  "Connect Wallet" button — the user always goes through `ConnectWallet` first.
- **Disconnect returns to `ConnectWallet`** because `AppInner` gates on
  `isConnected`. No explicit redirect needed.

---

## Human Action Required: Test

Make sure Freighter is installed in your browser and set to **Stellar Testnet**.

1. Hard-reload `http://localhost:3000/`
2. Should see the **ConnectWallet** landing page (not the dashboard)
3. Click **Connect with Freighter** → Freighter popup appears
4. Approve in Freighter → dashboard loads, header shows `Gxxxxx…xxxx` + disconnect icon
5. Hard-refresh → still connected (auto-reconnect from localStorage)
6. Click disconnect (↪) → returns to landing page
7. No MetaMask / "no elements" errors in browser console

---

## Verification Checklist

- [x] Dashboard renders without JS errors (React version mismatch fixed)
- [x] ConnectWallet landing shown for visitors without stored `publicKey`
- [ ] "Connect with Freighter" triggers Freighter popup
- [ ] Public key displayed in header after approval
- [ ] Auto-reconnect persists across hard-refresh
- [ ] Disconnect clears state and returns to landing
- [ ] Amber "not detected" banner appears when extension is absent
- [ ] No MetaMask / "no elements in sequence" errors in console

**Do not proceed to U3 until all items above are checked.**

---

## What Didn't Change

- All existing agent components (`TaskInput`, `ActivityFeed`, `WalletPanel`, etc.)
- Orchestrator backend
- WebSocket connection and event handling
- The existing `WalletPanel` (shows server-side orchestrator wallet balance) —
  separate from the user's external wallet connected here
