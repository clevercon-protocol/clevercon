# CleverCon MCP Server

A Model Context Protocol (MCP) server that exposes CleverCon's marketplace rail (hire a service, track a task) and lower-level agent discovery, vault views, and payment building as MCP tools. This enables AI agents and other MCP-compatible clients to discover, hire, and pay for services on the CleverCon network without custom integration.

## Features

- **Hire the rail**: Create tasks (hire a service) and track them through to completion via the API, authenticated with a scoped API key. This is the path most agents want.
- **Agent Discovery**: Search and retrieve agent manifests with reputation data
- **Vault Operations**: Read vault balances and states (view-only)
- **Payment Building**: Generate unsigned XDR for deposits and payment releases
- **Cost Estimation**: Get pricing estimates for capabilities
- **Keyless payment building**: The XDR builders never hold keys or sign; they return unsigned XDR the client's wallet signs. (The hire-flow tools authenticate to the API with a scoped key, which grants no signing authority over funds.)

## Installation

```bash
cd packages/mcp
npm install
npm run build
```

## Configuration

Set these environment variables:

```bash
# CleverCon API (the live rail used by the hire-flow tools)
CLEVERCON_API_URL=http://localhost:4100
CLEVERCON_API_KEY=cc_yourprefix.yoursecret   # required for hire_agent/list_tasks/get_task/dispute_task

# Registry API endpoint (used by the discovery tools)
REGISTRY_URL=http://localhost:3001

# Stellar network configuration
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Contract addresses
AGENT_VAULT_CONTRACT_ID=CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO
USDC_SAC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

## Usage

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start

# Or use the binary directly
./dist/server.js
```

The server runs over stdio transport by default, suitable for MCP clients.

### Claude Desktop Configuration

Add this to your Claude Desktop `config.json`:

```json
{
  "mcpServers": {
    "clevercon": {
      "command": "/path/to/clevercon/packages/mcp/dist/server.js",
      "env": {
        "CLEVERCON_API_URL": "http://localhost:4100",
        "CLEVERCON_API_KEY": "cc_yourprefix.yoursecret",
        "REGISTRY_URL": "https://registry.clevercon.net",
        "STELLAR_RPC_URL": "https://soroban-testnet.stellar.org",
        "AGENT_VAULT_CONTRACT_ID": "CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO",
        "USDC_SAC": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
      }
    }
  }
}
```

## Available Tools

### Hire-flow tools (the live rail)

These drive the CleverCon API and require `CLEVERCON_API_KEY`.

#### `hire_agent`

Create a task (hire a service). `DIRECT` pays a chosen `serviceId`; `SEARCH` finds and pays one service; `COMPOSE` runs a multi-service job.

**Parameters:**
- `title` (required): human-readable task title
- `mode` (required): `DIRECT` | `SEARCH` | `COMPOSE`
- `budget` (required): max spend in USDC
- `serviceId` (required for `DIRECT`), `policyId`, `description` (optional)

```json
{ "title": "Summarize XLM news", "mode": "SEARCH", "budget": 1.0 }
```

#### `list_tasks`

List the caller's tasks, optionally filtered by `status` (`DRAFT`, `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `DISPUTED`, `FAILED`), with `limit`/`offset`.

#### `get_task`

Fetch one of the caller's tasks by `id`, including its steps and their outputs.

#### `dispute_task`

Raise a dispute on one of the caller's tasks. Parameters: `id` (required), `reason` (optional).

### Discovery and vault tools

### `search_agents`

Search for agents by capability. Backed by the registry's `GET /agents?capabilities=<cap>` route.

**Parameters:**
- `capability` (required): Capability to search for
- `limit` (optional): Maximum results (default: 10)

**Example:**
```json
{
  "capability": "web-scraping",
  "limit": 5
}
```

### `get_agent`

Get detailed information about a specific agent.

**Parameters:**
- `id` (required): Agent ID to look up

**Example:**
```json
{
  "id": "web-intel-001"
}
```

### `get_vault_balance`

Read vault balance and state for a Stellar address.

**Parameters:**
- `address` (required): Stellar address to check

**Example:**
```json
{
  "address": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### `build_deposit`

Build unsigned XDR for a vault deposit transaction.

**Parameters:**
- `address` (required): Stellar address of depositor
- `amount` (required): Amount in USDC
- `asset` (optional): Asset type (default: "USDC")

**Example:**
```json
{
  "address": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "amount": 10.5
}
```

### `build_release`

Build unsigned XDR for a payment release transaction.

**Parameters:**
- `orchestrator_address` (required): Orchestrator's Stellar address
- `task_id` (required): Task ID
- `step_id` (required): Step ID  
- `amount` (required): Amount in USDC
- `asset` (optional): Asset type (default: "USDC")

**Example:**
```json
{
  "orchestrator_address": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "task_id": "12345",
  "step_id": "1",
  "amount": 0.05
}
```

### `estimate_cost`

Get pricing estimates for a capability.

**Parameters:**
- `capability` (required): Capability to estimate cost for

**Example:**
```json
{
  "capability": "data-analysis"
}
```

## Manual Testing

Here's a smoke test transcript you can run:

```bash
# Start the server
npm run dev

# Test with our smoke test script (includes MCP handshake)
npm test
```

Expected response should list all 10 tools: the hire-flow tools `hire_agent`, `list_tasks`, `get_task`, `dispute_task`, plus the discovery/vault tools `search_agents`, `get_agent`, `get_vault_balance`, `build_deposit`, `build_release`, and `estimate_cost`.

**Note**: Direct JSON-RPC requests require proper MCP initialization handshake first.

### Test Individual Tools

Use the smoke test script which properly handles MCP initialization:

```bash
npm test
```

This tests:
- Tool discovery via `tools/list`
- Agent search functionality
- Cost estimation functionality
- Proper error handling for network failures

## Security Model

- **Keyless**: The server never holds private keys or signs transactions
- **Read-only vault operations**: Balance queries are view-only via Soroban RPC
- **Unsigned XDR only**: Payment tools return unsigned transaction XDR that must be signed by the client's wallet
- **No custody**: Maintains CleverCon's non-custodial guarantee

## Error Handling

All tools return structured errors when:
- Registry or RPC endpoints are unreachable
- Invalid parameters are provided
- Agents or vault states are not found
- Transaction building fails

Errors include clear messages and preserve the original request context.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests (when available)
npm test
```

## Integration with CleverCon

This MCP server integrates with:
- **Registry API** (`packages/registry`) for agent discovery and search
- **Agent Vault Client** patterns from `packages/orchestrator` for vault operations
- **Common types** (`packages/common`) for consistent data structures
- **Soroban RPC** for direct vault contract interaction

See the main [CleverCon README](../../README.md) for complete system architecture.