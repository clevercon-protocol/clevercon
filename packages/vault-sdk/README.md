# @clevercon/vault-sdk

Reusable typed SDK for the CleverVault Soroban smart contract.

## Features

- **Typed methods** for every contract entrypoint (deposit, withdraw, register/update orchestrator, create/complete/cancel task, release payment, all `get_*` views)
- **Structured errors** — `VaultContractError` with `code`, `codeName`, and `known` flag; unknown/newer codes are preserved, never swallowed
- **Event subscription** — helper over Soroban RPC `getEvents` with typed payloads and cursor handling
- **Mock mode** — dependency-free deterministic responses for local development and testing
- **Network config** — mainnet/testnet selection, contract ID, RPC URL

## Quick Start

```ts
import { VaultClient } from '@clevercon/vault-sdk';

const vault = new VaultClient({
  contractId: process.env.AGENT_VAULT_CONTRACT_ID!,
  rpcUrl: process.env.STELLAR_RPC_URL,
  network: 'testnet',
  usdcSac: process.env.USDC_SAC,
});

// Read-only views
const balance = await vault.getBalance(userAddress);
const account = await vault.getAccount(userAddress);
const task = await vault.getTask(taskId);
const status = await vault.getTaskStatus(taskId);

// State-changing calls (returns unsigned XDR for Freighter)
const xdr = await vault.buildDepositXdr(userAddress, 100);
// ... user signs in Freighter ...
await vault.submitSignedXdr(signedXdr);

// Server-side calls (signed with keypair)
const newTaskId = await vault.createTask(orchestratorKeypair, 50);
await vault.releasePayment(orchestratorKeypair, newTaskId, 1n, 10);
await vault.completeTask(orchestratorKeypair, newTaskId);
```

## Mock Mode

For testing without RPC connectivity:

```ts
import { createMockVaultClient } from '@clevercon/vault-sdk';

const mock = createMockVaultClient();

// Simulate operations
await mock.mockDeposit(userAddress, 100);
await mock.mockRegisterOrchestrator(userAddress, orchAddress, 'MyOrch');
const taskId = await mock.mockCreateTask(orchAddress, 10);

// Read state
const balance = await mock.getBalance(userAddress);
const task = await mock.getTask(taskId);
```

## Error Handling

```ts
import { VaultContractError, VaultErrorCode } from '@clevercon/vault-sdk';

try {
  await vault.releasePayment(keypair, taskId, 1n, 100);
} catch (err) {
  if (err instanceof VaultContractError) {
    switch (err.code) {
      case VaultErrorCode.ExceedsPlanCost:
        // Handle over-budget
        break;
      case VaultErrorCode.TaskAlreadyCompleted:
        // Handle completed task
        break;
      default:
        if (!err.known) {
          // Unknown error code — contract may have been upgraded
        }
    }
  }
}
```

## Event Subscription

```ts
import { subscribeEvents } from '@clevercon/vault-sdk';

const sub = subscribeEvents(
  {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractId: 'C...',
    topics: ['release', 'task_done'],
    pollIntervalMs: 5000,
  },
  (event) => {
    switch (event.type) {
      case 'release':
        console.log(`Released ${event.payload.amount} for task ${event.payload.task_id}`);
        break;
      case 'task_done':
        console.log(`Task ${event.payload.task_id} done, spent ${event.payload.spent}`);
        break;
    }
  },
);

// Stop later
sub.stop();
```

## Architecture

```
packages/vault-sdk/
├── src/
│   ├── index.ts          # Barrel exports
│   ├── client.ts         # VaultClient — wraps every contract entrypoint
│   ├── errors.ts         # VaultError model (mirrors lib.rs)
│   ├── types.ts          # TypeScript interfaces for contract data
│   ├── events.ts         # Event subscription with cursor handling
│   ├── mock.ts           # Dependency-free mock mode
│   ├── vault-errors.test.ts  # Divergence test against lib.rs
│   └── client.test.ts    # Unit tests for client and mock
├── package.json
├── tsconfig.json
└── README.md
```

## Error Sync

The `vault-errors.test.ts` file reads `contracts/agent-vault/src/lib.rs` at test time and verifies that `VaultErrorCode` matches every variant and discriminant. If the contract adds a new error variant, the test fails until the SDK is updated.
