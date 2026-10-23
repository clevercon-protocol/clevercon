/**
 * receipt(txHash): read, from the ledger, HOW a CleverCon release was authorized.
 *
 * The trust guarantee is only as good as your ability to check it, so this decodes
 * the on-chain transaction and tells you which lane authorized the spend:
 *   - public  (release_payment_session)      -> a bounded SESSION KEY signed it
 *   - private (release_payment_proved_batch)  -> a zero-knowledge PROOF authorized
 *     it and the relayer only submitted + paid the fee
 * So if a server ever substituted its own key for your proof, or spent off a key
 * you did not authorize, it shows up here against the ledger. Read-only, no key.
 */
import {
  TransactionBuilder,
  Networks,
  Operation,
  scValToNative,
  xdr,
  rpc,
} from '@stellar/stellar-sdk';

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const UNIT = 10_000_000; // 1 USDC in stroops

export type ReceiptAuthorizer =
  | { lane: 'public'; kind: 'session-key'; sessionKey: string }
  | { lane: 'private'; kind: 'zk-proof'; relayer: string };

export interface Receipt {
  txHash: string;
  method: string;
  authorizer: ReceiptAuthorizer;
  payees: string[];
  amountsUsdc: number[];
  createdAt?: string;
}

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptError';
  }
}

/**
 * Decode a CleverCon release transaction into a Receipt. `txHash` is the hash a
 * release returned (session pay, or a batch job's settlement tx). Throws if the tx
 * is not found, not successful, or not a recognised CleverCon release.
 */
export async function receipt(opts: {
  txHash: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}): Promise<Receipt> {
  const passphrase = opts.networkPassphrase ?? Networks.TESTNET;
  const server = new rpc.Server(opts.rpcUrl ?? DEFAULT_RPC_URL);

  const got = await server.getTransaction(opts.txHash);
  if (got.status !== 'SUCCESS') {
    throw new ReceiptError(`tx ${opts.txHash} is ${got.status}`);
  }

  // Unwrap the invoke-contract call: contract fn name + its ScVal args.
  const tx = TransactionBuilder.fromXDR(got.envelopeXdr, passphrase);
  const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
  const op = inner.operations[0] as Operation.InvokeHostFunction | undefined;
  if (!op || op.type !== 'invokeHostFunction') {
    throw new ReceiptError('not a Soroban contract invocation');
  }
  const hf = op.func;
  if (hf.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw new ReceiptError('not a contract call');
  }
  const ic = hf.invokeContract();
  const method = ic.functionName().toString();
  const args = ic.args();
  const native = (v: xdr.ScVal) => scValToNative(v);
  const createdAt = got.createdAt
    ? new Date(Number(got.createdAt) * 1000).toISOString()
    : undefined;

  if (method === 'release_payment_session') {
    // args: [session, payee, amount]
    return {
      txHash: opts.txHash,
      method,
      authorizer: { lane: 'public', kind: 'session-key', sessionKey: String(native(args[0])) },
      payees: [String(native(args[1]))],
      amountsUsdc: [Number(native(args[2])) / UNIT],
      createdAt,
    };
  }

  if (method === 'release_payment_proved_batch') {
    // args: [orchestrator, task_id, step_id, asset, payees, amounts, nullifiers, ...]
    const payees = (native(args[4]) as unknown[]).map((p) => String(p));
    const amounts = (native(args[5]) as unknown[]).map((a) => Number(a) / UNIT);
    return {
      txHash: opts.txHash,
      method,
      authorizer: { lane: 'private', kind: 'zk-proof', relayer: String(native(args[0])) },
      payees,
      amountsUsdc: amounts,
      createdAt,
    };
  }

  throw new ReceiptError(`not a CleverCon release (method: ${method})`);
}
