/**
 * build_release MCP tool
 * 
 * Builds unsigned XDR for a vault payment release transaction.
 * Returns XDR that must be signed by the orchestrator's wallet.
 */

import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';

export const buildReleaseSchema = {
  name: 'build_release',
  description: 'Build unsigned XDR for a vault payment release transaction',
  inputSchema: {
    type: 'object',
    properties: {
      orchestrator_address: {
        type: 'string',
        description: 'Stellar address of the orchestrator releasing the payment',
      },
      task_id: {
        type: 'string',
        description: 'Task ID (will be converted to u64)',
      },
      step_id: {
        type: 'string', 
        description: 'Step ID (will be converted to u64)',
      },
      amount: {
        type: 'number',
        description: 'Amount to release in USDC (decimal)',
        minimum: 0.000001,
      },
      asset: {
        type: 'string',
        description: 'Asset to release (currently only "USDC" supported)',
        enum: ['USDC'],
        default: 'USDC',
      },
    },
    required: ['orchestrator_address', 'task_id', 'step_id', 'amount'],
  },
};

interface ReleaseXdrResult {
  success: boolean;
  xdr?: string;
  transaction_details?: {
    orchestrator_address: string;
    task_id: string;
    step_id: string;
    amount_usdc: number;
    asset: string;
    contract_id: string;
  };
  error?: string;
}

export async function buildReleaseHandler(
  args: Record<string, unknown>,
  config: { 
    soroban_rpc_url: string;
    network_passphrase: string;
    vault_contract_id: string;
    usdc_sac: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { orchestrator_address, task_id, step_id, amount, asset = 'USDC' } = args;

    // Validate inputs
    if (typeof orchestrator_address !== 'string' || orchestrator_address.trim() === '') {
      throw new Error('orchestrator_address must be a non-empty string');
    }

    if (typeof task_id !== 'string' || task_id.trim() === '') {
      throw new Error('task_id must be a non-empty string');
    }

    if (typeof step_id !== 'string' || step_id.trim() === '') {
      throw new Error('step_id must be a non-empty string');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('amount must be a positive number');
    }

    if (asset !== 'USDC') {
      throw new Error('Only USDC releases are currently supported');
    }

    if (!config.vault_contract_id || config.vault_contract_id.trim() === '') {
      throw new Error('Vault contract ID not configured');
    }

    if (!config.usdc_sac || config.usdc_sac.trim() === '') {
      throw new Error('USDC SAC address not configured');
    }

    const stellarAddress = orchestrator_address.trim();
    const taskIdStr = task_id.trim();
    const stepIdStr = step_id.trim();
    const amountUsdc = amount as number;

    // Validate Stellar address format
    try {
      new Address(stellarAddress);
    } catch {
      throw new Error('Invalid Stellar address format');
    }

    // Convert task_id and step_id to numbers
    const taskIdNum = BigInt(taskIdStr);
    const stepIdNum = BigInt(stepIdStr);

    // Build unsigned XDR
    const server = new SorobanRpc.Server(config.soroban_rpc_url, { allowHttp: false });
    const account = await server.getAccount(stellarAddress);
    const contract = new Contract(config.vault_contract_id);

    // Convert USDC to stroops (7 decimal places)
    const STROOPS_PER_USDC = 10_000_000;
    const amountStroops = BigInt(Math.round(amountUsdc * STROOPS_PER_USDC));

    // Build transaction
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.network_passphrase,
    })
      .addOperation(contract.call('release_payment',
        new Address(stellarAddress).toScVal(),
        nativeToScVal(taskIdNum, { type: 'u64' }),
        nativeToScVal(stepIdNum, { type: 'u64' }),
        new Address(config.usdc_sac).toScVal(),
        nativeToScVal(amountStroops, { type: 'i128' })
      ))
      .setTimeout(300)
      .build();

    // Simulate transaction
    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new Error(`Simulation failed: ${simulated.error}`);
    }

    // Assemble and return unsigned XDR
    const assembledTx = SorobanRpc.assembleTransaction(tx, simulated).build();
    const unsignedXdr = assembledTx.toXDR();

    const result: ReleaseXdrResult = {
      success: true,
      xdr: unsignedXdr,
      transaction_details: {
        orchestrator_address: stellarAddress,
        task_id: taskIdStr,
        step_id: stepIdStr,
        amount_usdc: amountUsdc,
        asset: 'USDC',
        contract_id: config.vault_contract_id,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };

  } catch (error) {
    const result: ReleaseXdrResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
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
}