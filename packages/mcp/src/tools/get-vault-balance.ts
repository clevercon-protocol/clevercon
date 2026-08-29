/**
 * get_vault_balance MCP tool
 * 
 * Reads vault account state via Soroban RPC (view-only).
 * Returns balance information for a given address.
 */

import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk';

export const getVaultBalanceSchema = {
  name: 'get_vault_balance',
  description: 'Get vault balance and state for a Stellar address',
  inputSchema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'Stellar address to check vault balance for',
      },
    },
    required: ['address'],
  },
};

interface VaultBalance {
  address: string;
  balance_usdc: number;
  locked_usdc: number;
  available_usdc: number;
  vault_exists: boolean;
}

export async function getVaultBalanceHandler(
  args: Record<string, unknown>,
  config: { 
    soroban_rpc_url: string;
    network_passphrase: string;
    vault_contract_id: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { address } = args;

    if (typeof address !== 'string' || address.trim() === '') {
      throw new Error('address must be a non-empty string');
    }

    if (!config.vault_contract_id || config.vault_contract_id.trim() === '') {
      throw new Error('Vault contract ID not configured');
    }

    const stellarAddress = address.trim();

    // Validate Stellar address format
    try {
      new Address(stellarAddress);
    } catch {
      throw new Error('Invalid Stellar address format');
    }

    const server = new SorobanRpc.Server(config.soroban_rpc_url, { allowHttp: false });
    const contract = new Contract(config.vault_contract_id);

    try {
      // Build transaction to call get_balance method
      const account = await server.getAccount(stellarAddress);
      const balanceTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.network_passphrase,
      })
        .addOperation(contract.call('get_balance', new Address(stellarAddress).toScVal()))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(balanceTx);

      if (SorobanRpc.Api.isSimulationError(simulation)) {
        // Vault doesn't exist for this address
        const result: VaultBalance = {
          address: stellarAddress,
          balance_usdc: 0,
          locked_usdc: 0,
          available_usdc: 0,
          vault_exists: false,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Parse the balance result (assuming it returns balance in stroops)
      const balanceStroops = scValToNative(simulation.result!.retval);
      const STROOPS_PER_USDC = 10_000_000;
      const balanceUsdc = Number(balanceStroops) / STROOPS_PER_USDC;

      // Try to get locked amount (this might not exist in all vault versions)
      let lockedUsdc = 0;
      try {
        const lockedTx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: config.network_passphrase,
        })
          .addOperation(contract.call('get_locked', new Address(stellarAddress).toScVal()))
          .setTimeout(300)
          .build();

        const lockedSimulation = await server.simulateTransaction(lockedTx);
        if (!SorobanRpc.Api.isSimulationError(lockedSimulation)) {
          const lockedStroops = scValToNative(lockedSimulation.result!.retval);
          lockedUsdc = Number(lockedStroops) / STROOPS_PER_USDC;
        }
      } catch {
        // Locked amount not available or method doesn't exist
      }

      const result: VaultBalance = {
        address: stellarAddress,
        balance_usdc: balanceUsdc,
        locked_usdc: lockedUsdc,
        available_usdc: Math.max(0, balanceUsdc - lockedUsdc),
        vault_exists: true,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };

    } catch {
      // Handle contract-specific errors
      const result: VaultBalance = {
        address: stellarAddress,
        balance_usdc: 0,
        locked_usdc: 0,
        available_usdc: 0,
        vault_exists: false,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Get vault balance failed',
            message: error instanceof Error ? error.message : String(error),
            address: args.address,
          }, null, 2),
        },
      ],
    };
  }
}