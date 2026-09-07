import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import type { AppEnv } from '../config/env.validation.js';

const STROOPS_PER_USDC = 10_000_000;

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

/**
 * CleverVault (AgentVault) Soroban client for the API. Deposits and withdrawals
 * are user-custodied: the API builds an unsigned XDR that the caller signs in
 * their wallet, then the API submits it. On-chain is the source of truth; the
 * Postgres mirror is updated by the indexer from the resulting event.
 *
 * When the contract id is unset or a placeholder the client is inactive and
 * every mutating call raises ServiceUnavailable (never a silent no-op or a fake
 * success), so the UI can honestly say the vault is not enabled here.
 *
 * Ported from packages/orchestrator/src/agent-vault-client.ts.
 */
@Injectable()
export class VaultContractService {
  private readonly logger = new Logger(VaultContractService.name);
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly usdcSac: string;
  readonly passphrase: string;
  readonly active: boolean;

  constructor(config: ConfigService<AppEnv, true>) {
    this.contractId = config.get('AGENT_VAULT_CONTRACT_ID', { infer: true }) ?? '';
    this.rpcUrl = config.get('STELLAR_RPC_URL', { infer: true });
    this.usdcSac = config.get('USDC_SAC', { infer: true }) ?? '';
    this.passphrase = config.get('NETWORK_PASSPHRASE', { infer: true });
    this.active = this.contractId.length > 10 && !this.contractId.startsWith('C...');
    if (!this.active) {
      this.logger.warn('AGENT_VAULT_CONTRACT_ID not set; vault deposit/withdraw disabled');
    }
  }

  private server(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl, { allowHttp: false });
  }

  private ensureActive(): void {
    if (!this.active) {
      throw new ServiceUnavailableException('Vault is not configured in this environment');
    }
  }

  private usdcSacScVal(): xdr.ScVal {
    if (!this.usdcSac) {
      throw new ServiceUnavailableException('USDC_SAC is required for vault transfers');
    }
    return new Address(this.usdcSac).toScVal();
  }

  /** Build + simulate a call, returning the assembled unsigned XDR to sign. */
  private async buildUnsignedXdr(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    const server = this.server();
    const account = await server.getAccount(sourceAddress);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new ServiceUnavailableException(`Vault simulation failed: ${simulated.error}`);
    }
    return SorobanRpc.assembleTransaction(tx, simulated).build().toXDR();
  }

  /** Unsigned `deposit(user, usdc_sac, amount)` XDR for the user to sign. */
  async buildDepositXdr(userAddress: string, amountUsdc: number): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'deposit', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /** Unsigned `withdraw(user, usdc_sac, amount)` XDR; fails on-chain if over available. */
  async buildWithdrawXdr(userAddress: string, amountUsdc: number): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'withdraw', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /** Submit a wallet-signed XDR and poll for confirmation; returns the tx hash. */
  async submitSignedXdr(signedXdr: string): Promise<string> {
    this.ensureActive();
    const server = this.server();
    const tx = TransactionBuilder.fromXDR(signedXdr, this.passphrase);
    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw new ServiceUnavailableException('Vault transaction was rejected on submit');
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new ServiceUnavailableException(`Vault transaction failed: ${response.hash}`);
      }
    }
    throw new ServiceUnavailableException(`Vault transaction timed out: ${response.hash}`);
  }
}
