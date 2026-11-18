# x402 agent-key mode

An autonomous agent that funds itself from a CleverCon vault and pays external
[x402](https://x402.org) services with those funds. It shows how the two
non-custodial halves of an agent economy compose:

- **Governed top-up.** The agent calls `wallet.topUp(amount)`, which pulls USDC
  from the owner's CleverCon vault into the agent's own wallet. The release is
  enforced on-chain by the owner's spending policy: the agent can never pull more
  than the ceiling the human set.
- **Autonomous spend.** The agent calls `wallet.fetch(url)` to hit any x402
  service. Each `402` challenge is settled transparently with the agent's own
  Stellar key.

The platform never holds the agent's key, and both legs settle in the **same**
USDC (the Stellar testnet USDC the vault dispenses is exactly the asset the x402
exact-scheme settles in), so there is no swap between them.

```ts
import { createAgentWallet } from '@clevercon/agent-sdk';

const wallet = createAgentWallet({
  apiKey: process.env.CLEVERCON_API_KEY!,   // scoped key from the vault owner
  secretKey: process.env.AGENT_SECRET_KEY!, // the agent's OWN Stellar key
});

await wallet.topUp(5);                        // vault -> agent wallet (policy-bound)
const res = await wallet.fetch(oracleUrl, {   // agent wallet -> x402 service
  method: 'POST',
  body: JSON.stringify({ query: 'xlm price' }),
});
```

## Run it

The agent's wallet must be a funded Stellar account with a USDC trustline (so the
vault release can land and the x402 payment can be signed). Point it at any x402
service (you can stand one up with `createAgent`; see the SDK README).

```bash
CLEVERCON_API_KEY=cc_...  \
AGENT_SECRET_KEY=S...      \
ORACLE_URL=http://localhost:4001/query \
npx tsx examples/x402-agent/agent.ts
```

The full loop is exercised on testnet by the repo's E2E harness
(`scripts/e2e-testnet.ts`, the `agent wallet funded from vault` and
`agent pays x402 service` stages).
