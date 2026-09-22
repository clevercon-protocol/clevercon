# CleverCon MCP Server

Give an AI agent a **bounded, non-custodial Stellar spending account** in two minutes. This Model Context Protocol server lets any MCP client (Claude Desktop, Cursor, your own agent) discover services, pay and disburse USDC, hire services, set spending limits, and read its budget and activity, all driven with a scoped API key and bounded on-chain by the vault. The agent can spend but never overspend or pay outside your rules, and never holds funds.

## How it works

Every action goes through the CleverCon API with your `x-api-key`. Spends are bounded by a policy (a per-payment cap, a rolling cap, and/or an allowlist) and released from your vault via a proof-gated on-chain path. The API key grants no signing authority over funds: it can only spend within the limits you set. Fund the vault and authorize Autopay once in the dApp; after that the agent spends autonomously within bounds.

## Installation

```bash
cd packages/mcp
npm install
npm run build
```

## Configuration

Only two variables are needed:

```bash
CLEVERCON_API_URL=http://localhost:4100
CLEVERCON_API_KEY=cc_yourprefix.yoursecret   # create one in the dApp Developer console
```

## Claude Desktop / Cursor configuration

```json
{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_API_URL": "http://localhost:4100",
        "CLEVERCON_API_KEY": "cc_yourprefix.yoursecret"
      }
    }
  }
}
```

## Tools

**Discover**
- `search_services` - browse the curated directory (filter by text/category, sort by recent/rating/price).
- `get_service` - details for one service by id.

**Spend** (bounded by a policy; released from the vault)
- `pay` - pay a single address. `{ payee, amount, reason?, policyId? }`
- `disburse` - pay many addresses in one instruction. `{ lines: [{ payee, amount, reason? }], policyId? }`
- `hire_agent` - hire a registered service. `{ title, mode, budget, serviceId?, policyId? }`

**Limits**
- `set_limit` - create a reusable spending limit; returns its `policyId`. `{ perPaymentCeilingUsdc?, rollingCapUsdc?, rollingWindowSecs?, allowlist?, isPrivate? }`
- `list_limits` - list saved limits.

**State**
- `get_budget` - vault position: balance, available, locked.
- `get_activity` - recent jobs and payments, newest first.
- `list_tasks` / `get_task` - task history and detail.
- `dispute_task` - raise a dispute on a task.

If you omit `policyId` on `pay`/`disburse`, a tight limit is derived from the payment itself (allowlist = the payees, cap = the largest line), so every spend is bounded by default.

## Testing

```bash
npm run dev   # run over stdio
npm test      # smoke test (MCP handshake + tools/list)
```

## Security model

- **Non-custodial**: the server never holds keys or funds. Spends are released from your vault by a bounded delegate; the API key cannot move funds outside your policy.
- **Bounded**: every spend is checked against a policy; the vault caps the total on-chain.
- **Metered**: API-key usage is metered and can carry a daily quota.

See the main [CleverCon README](../../README.md) for the full architecture.
