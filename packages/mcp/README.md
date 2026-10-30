# @clevercon/mcp

Give an AI agent a **bounded, non-custodial Stellar spending account** over the Model
Context Protocol. Any MCP client (Claude Desktop, Cursor, or your own agent) can discover
services, spend USDC within rules you set, hire services, and read its budget and
activity, bounded on-chain by a vault. The agent can spend, but never overspend, pay
outside your rules, or hold your funds.

Part of [CleverCon](https://clevercon.xyz). For programmatic use (no MCP client), see the
SDK, [`@clevercon/agent-sdk`](https://www.npmjs.com/package/@clevercon/agent-sdk).

## Install

No install needed, run it on demand:

```bash
npx -y @clevercon/mcp
```

Or install globally to get the `clevercon-mcp` command: `npm install -g @clevercon/mcp`.
Requires Node 18+.

## Two spending lanes

A spend is authorized in one of two ways; you pick per agent by which keys you provide.

- **Private (self-custody, keyless).** `disburse_private` proves your hidden policy
  **locally** and relays only a zero-knowledge proof; the vault releases funds against
  your pinned commitment with a fresh nullifier, so no key signs the spend and the server
  never sees your rule. This is the headline: private and trustless. You provide a
  **policy key** (`CLEVERCON_POLICY_KEY`) copied from the dapp's Rules tab.
- **Public / Fast.** `session_pay` spends through a bounded on-chain **session** (a cap,
  payee allowlist, and expiry the vault enforces on every release), with no per-payment
  proof, for high-frequency low-value work. It runs in one of two modes:
  - `local` (default): **your agent holds its own session key** (`CLEVERCON_SESSION_SECRET`),
    signs directly against Soroban, and never touches the API. Self-custody.
  - `server`: the account's **Managed Session**, set up once in the dapp, is used via the
    API with your `CLEVERCON_API_KEY`. The platform holds a tight, on-chain-bounded,
    instantly-revocable session key (never a private rule, never a general spend key).

Either lane is bounded on-chain, so a compromised agent can never exceed the cap,
allowlist, or rule you set.

## Prerequisites

1. Open the app at **https://clevercon.xyz** and connect a Stellar wallet (testnet). The
   Vault tab has a one-click testnet quickstart (fund XLM, add the USDC trustline, get test
   USDC).
2. **Fund your vault.**
3. Set up the lane your agent will use, in the dapp:
   - **Private:** create a rule on the **Rules** tab, pin it, and copy its **policy key**
     (`ccpk1_...`).
   - **Public (local):** create a session key on the **Vault** tab (generate or authorize
     your own address) and copy its **session secret**.
   - **Public (server):** enable a **Managed Session** on the Vault tab, and mint a scoped
     **API key** (`cc_<prefix>.<secret>`) in the Developer console.

## Configure your MCP client

Add CleverCon to your client's MCP config with the keys for the lane(s) you want.

**Private lane** (self-custody, trustless):

```json
{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_POLICY_KEY": "ccpk1_...from the Rules tab"
      }
    }
  }
}
```

**Public lane, local** (agent holds its own session key):

```json
{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_PUBLIC_MODE": "local",
        "CLEVERCON_SESSION_SECRET": "S...your session key secret"
      }
    }
  }
}
```

Add `CLEVERCON_API_KEY` as well to enable the directory, hire, read, and dispute tools
(and the server-mode public lane). Restart the client after editing the config.

### Environment variables

| Variable | Lane / use | Required |
| --- | --- | --- |
| `CLEVERCON_POLICY_KEY` | private `disburse_private` (policy key from the Rules tab) | for private spend |
| `CLEVERCON_GLOBAL_KEY` | private: the account's global-private rule, if one is set | only if a global-private exists |
| `CLEVERCON_PUBLIC_MODE` | public `session_pay`: `local` (default) or `server` | no |
| `CLEVERCON_SESSION_SECRET` | public local: your session key's secret (you hold it) | for local public spend |
| `CLEVERCON_SESSION_KEY` | alternative to the secret (a token carrying key + vault) | optional |
| `CLEVERCON_API_KEY` | directory / hire / read / dispute tools, and server-mode public | for those tools |
| `CLEVERCON_API_URL` | self-hosted API base | no (defaults to the live API) |
| `CLEVERCON_VAULT_ID`, `CLEVERCON_USDC_SAC` | override the network defaults | no |

The vault and USDC asset default to the live testnet contracts, so local-mode spending
needs only the one secret.

## Tools

**Discover**
- `search_services` — browse the service directory (filter by text/category; sort by recent, rating, or price).
- `get_service` — details for one service by id (name, provider, price per call, rating).

**Spend, private** (self-custody, keyless, trustless)
- `disburse_private` — pay up to 4 payees in one proof, proving your private policy locally. `{ lines: [{ payee, amount }] }`

**Spend, public / Fast** (bounded on-chain session; no per-payment proof)
- `session_pay` — spend through your bounded session. `{ payee, amount, ruleId? }`
- `session_scope` — read the session's live on-chain scope (remaining budget, allowlist, expiry).

**Hire**
- `hire_agent` — hire a registered service, paid per step. `{ title, mode, budget, serviceId? }`

**Limits**
- `set_limit` — create a reusable limit; returns a `policyId`. `{ perPaymentCeilingUsdc?, rollingCapUsdc?, rollingWindowSecs?, allowlist?, isPrivate? }`
- `list_limits` — list saved limits.

**State & lifecycle**
- `get_budget` — vault position: balance, available, locked.
- `get_activity` — recent jobs and payments, newest first.
- `list_tasks` / `get_task` — task history and detail.
- `dispute_task` — raise a dispute on a task.
- `approve_task` — approve a held delivery (releases a T2/T3 job).

The legacy `pay` / `disburse` tools (a managed server-signed path) are **retired**; use
`disburse_private` for private self-custody spend, or `session_pay` for the public lane.

## Example prompts

Once configured, you can ask your agent things like:

- "Pay `G...ABC` 5 USDC for the logo work, privately."
- "Split 30 USDC between these three addresses."
- "What's my remaining session budget?"
- "Find a price-oracle service and hire it with a 2 USDC budget."
- "What's my vault balance?"

## Security model

- **Non-custodial.** In the private and public-local lanes you hold the only secret (the
  salt or the session key); the server holds no key that can move your funds. In the
  public-server lane (Managed Session) the platform holds a tight, on-chain-bounded,
  revocable session key only, never a private rule and never a general spend key.
- **Bounded on-chain.** Every spend is checked by the vault against your pinned rule
  (private) or session scope (public); neither the agent nor the server can exceed it.
- **Private.** Your private rule is committed on-chain, never published, and proven
  locally. A rejected private payment reveals nothing on-chain about the rule.
- **Metered.** API-key usage (directory/hire/read tools) is metered and can carry a daily quota.

## Troubleshooting

- **A private spend says no policy** — set `CLEVERCON_POLICY_KEY` to the `ccpk1_...` key from the dapp's Rules tab.
- **A public spend fails** — check the session's scope with `session_scope` (budget left, payee allowlisted, not expired), and that `CLEVERCON_SESSION_SECRET` is set (local mode) or a Managed Session is enabled (server mode).
- **401 / invalid API key** — check `CLEVERCON_API_KEY` is the full `cc_<prefix>.<secret>`.
- **Self-hosting the API** — set `CLEVERCON_API_URL` to your API base.

## Links

- App and Developer console: https://clevercon.xyz
- Programmatic SDK: [`@clevercon/agent-sdk`](https://www.npmjs.com/package/@clevercon/agent-sdk)
- Source and issues: https://github.com/clevercon-protocol/clevercon

## License

MIT
