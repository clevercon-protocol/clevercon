# CleverCon MCP Server

A Model Context Protocol (MCP) server that exposes CleverCon's agent discovery, vault operations, and payment building capabilities as MCP tools. This enables AI agents and other MCP-compatible clients to discover and pay for services on the CleverCon network without custom integration.

## Features

- **Agent Discovery**: Search and retrieve agent manifests with reputation data
- **Vault Operations**: Read vault balances and states (view-only)
- **Payment Building**: Generate unsigned XDR for deposits and payment releases
- **Cost Estimation**: Get pricing estimates for capabilities
- **Keyless by Design**: Server never holds keys or signs transactions - all payment operations return unsigned XDR

## Installation

```bash
cd packages/mcp
npm install
npm run build
```

## Configuration

Set these environment variables:

```bash
# Registry API endpoint
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

### `search_agents`

Search for agents by capability and optional category.

**Parameters:**
- `capability` (required): Capability to search for
- `category` (optional): Category filter
- `limit` (optional): Maximum results (default: 10)

**Example:**
```json
{
  "capability": "web-scraping",
  "category": "Data and Oracles",
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

# In another terminal, test with MCP client or simulate requests
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node dist/server.js
```

Expected response should list all 6 tools: `search_agents`, `get_agent`, `get_vault_balance`, `build_deposit`, `build_release`, and `estimate_cost`.

### Test Individual Tools

```bash
# Test search agents
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search_agents", "arguments": {"capability": "web-scraping"}}}' | node dist/server.js

# Test get vault balance  
echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_vault_balance", "arguments": {"address": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}}}' | node dist/server.js

# Test cost estimation
echo '{"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "estimate_cost", "arguments": {"capability": "data-analysis"}}}' | node dist/server.js
```

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