import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  scValToNative,
  type xdr,
} from '@stellar/stellar-sdk';

/**
 * Serialize async work per key, run different keys in parallel. Every on-chain
 * operation signed by a given delegate goes through this, so one signer's
 * transactions never race on its sequence number, while other users settle
 * concurrently. A rejected op does not wedge the key (the next waiter still runs).
 */
export class KeyedMutex {
  private chains = new Map<string, Promise<unknown>>();

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run as Promise<T>;
  }
}

/** All delegate on-chain ops route through this so a signer's txs are serialized. */
export const delegateMutex = new KeyedMutex();

interface ErrorResultCarrier {
  errorResult?: { result: () => { switch: () => { name: string } } };
}

function txResultName(resp: ErrorResultCarrier): string {
  try {
    return resp.errorResult?.result().switch().name ?? 'error';
  } catch {
    return 'error';
  }
}

export interface SorobanOpts {
  rpcUrl: string;
  passphrase: string;
  contractId: string;
  attempts?: number;
}

export interface SorobanSubmitResult {
  hash: string;
  returnValue: unknown;
}

/**
 * Build, simulate, sign, and submit a delegate contract call, retrying on a
 * stale sequence number (txBadSeq) with a fresh account fetch. This covers the
 * cross-process case where the API's on-chain lock and the worker's release
 * momentarily pick the same sequence for a shared signer. Serialize same-signer
 * calls with `delegateMutex` on top of this to avoid the race in the first place.
 */
export async function submitDelegateCall(
  kp: Keypair,
  method: string,
  args: xdr.ScVal[],
  opts: SorobanOpts,
): Promise<SorobanSubmitResult> {
  const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
  const contract = new Contract(opts.contractId);
  const attempts = opts.attempts ?? 4;
  let lastErr = 'unknown';

  for (let attempt = 0; attempt < attempts; attempt++) {
    const account = await server.getAccount(kp.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: opts.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(120)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      // A simulation error is deterministic (contract error, bad args); do not
      // retry. The caller inspects the message (e.g. for #9 TaskAlreadyCompleted).
      throw new Error(`${method} simulation failed: ${simulated.error}`);
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(kp);
    const response = await server.sendTransaction(prepared);

    if (response.status === 'ERROR') {
      const name = txResultName(response as ErrorResultCarrier);
      lastErr = name;
      if (name === 'txBadSeq') {
        await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
        continue; // refetch the account and rebuild with a fresh sequence
      }
      throw new Error(`${method} rejected on submit: ${name}`);
    }

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          hash: response.hash,
          returnValue: result.returnValue ? scValToNative(result.returnValue) : null,
        };
      }
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`${method} failed on-chain: ${response.hash}`);
      }
    }
    throw new Error(`${method} timed out: ${response.hash}`);
  }
  throw new Error(`${method} failed after ${attempts} attempts (last: ${lastErr})`);
}
