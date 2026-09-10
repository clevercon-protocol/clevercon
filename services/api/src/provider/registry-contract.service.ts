import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Address,
  type xdr,
} from '@stellar/stellar-sdk';
import type { AppEnv } from '../config/env.validation.js';

/**
 * Client for the on-chain agent registry (contracts/registry). The platform is
 * the registry admin/owner here, so it anchors service manifest hashes and
 * reputation on-chain automatically (server-signed). Inactive (every call a
 * no-op) unless REGISTRY_CONTRACT_ID + REGISTRY_ADMIN_KEY are configured, so
 * registration never fails because anchoring is off or the chain hiccups.
 */
@Injectable()
export class RegistryContractService {
  private readonly logger = new Logger(RegistryContractService.name);
  private readonly contractId: string;
  private readonly adminKey: string;
  private readonly rpcUrl: string;
  private readonly passphrase: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.contractId = config.get('REGISTRY_CONTRACT_ID', { infer: true }) ?? '';
    this.adminKey = config.get('REGISTRY_ADMIN_KEY', { infer: true }) ?? '';
    this.rpcUrl = config.get('STELLAR_RPC_URL', { infer: true });
    this.passphrase = config.get('NETWORK_PASSPHRASE', { infer: true });
  }

  get active(): boolean {
    return this.contractId.length > 10 && this.adminKey.length > 0;
  }

  private async signAndSubmit(method: string, args: xdr.ScVal[]): Promise<string> {
    const server = new SorobanRpc.Server(this.rpcUrl, { allowHttp: false });
    const kp = Keypair.fromSecret(this.adminKey);
    const account = await server.getAccount(kp.publicKey());
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(120)
      .build();
    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new Error(`${method} simulation failed: ${simulated.error}`);
    }
    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(kp);
    const response = await server.sendTransaction(prepared);
    if (response.status === 'ERROR') throw new Error(`${method} rejected on submit`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`${method} failed on-chain: ${response.hash}`);
      }
    }
    throw new Error(`${method} timed out: ${response.hash}`);
  }

  private adminAddress(): string {
    return Keypair.fromSecret(this.adminKey).publicKey();
  }

  /**
   * Anchor (or refresh) a listing's manifest hash on-chain, platform-owned.
   * Best-effort: logs and swallows errors so service registration/edit never
   * fails because of the chain. Returns the tx hash on success.
   */
  async anchorManifest(
    agentId: string,
    manifestHashHex: string,
    payee: string,
  ): Promise<string | null> {
    if (!this.active) return null;
    try {
      const hash = Buffer.from(manifestHashHex, 'hex');
      return await this.signAndSubmit('register', [
        new Address(this.adminAddress()).toScVal(),
        nativeToScVal(agentId, { type: 'string' }),
        nativeToScVal(hash, { type: 'bytes' }),
        new Address(payee).toScVal(),
      ]);
    } catch (err) {
      this.logger.warn(`manifest anchor skipped for ${agentId}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Fold one job outcome into the on-chain reputation (admin). Best-effort. */
  async recordJob(agentId: string, success: boolean, quality: number): Promise<string | null> {
    if (!this.active) return null;
    try {
      return await this.signAndSubmit('record_job', [
        new Address(this.adminAddress()).toScVal(),
        nativeToScVal(agentId, { type: 'string' }),
        nativeToScVal(success, { type: 'bool' }),
        nativeToScVal(Math.max(0, Math.min(100, Math.round(quality))), { type: 'u32' }),
      ]);
    } catch (err) {
      this.logger.warn(`reputation anchor skipped for ${agentId}: ${(err as Error).message}`);
      return null;
    }
  }
}
