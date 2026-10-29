import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  rpc as SorobanRpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppEnv } from '../config/env.validation.js';

/** Once every 24h per account. */
const CLAIM_TTL_SECONDS = 24 * 60 * 60;

export interface FaucetStatus {
  /** Whether a funded faucet wallet is configured in this environment. */
  available: boolean;
  /** How much classic USDC a claim sends. */
  amountUsdc: number;
}

/**
 * Testnet-only USDC faucet for the tester quickstart. Sends a small, fixed
 * amount of classic USDC (the asset the vault's SAC wraps) from an
 * operator-funded wallet to the tester's own wallet so they can add a trustline,
 * claim USDC, and deposit without leaving the app. Rate-limited per account and
 * gated on FAUCET_SECRET_KEY, so it is strictly opt-in and cannot drain funds.
 * This moves no one else's money: it is a convenience wallet the operator tops up.
 */
@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly secret: string;
  private readonly amount: number;
  private readonly rpcUrl: string;
  private readonly passphrase: string;
  private readonly usdcIssuer: string;
  private redis: Redis | null = null;
  /** Per-process fallback when no Redis is configured (testnet convenience). */
  private readonly localClaims = new Map<string, number>();

  constructor(
    config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {
    this.secret = config.get('FAUCET_SECRET_KEY', { infer: true }) ?? '';
    this.amount = config.get('FAUCET_USDC_AMOUNT', { infer: true });
    this.rpcUrl = config.get('STELLAR_RPC_URL', { infer: true });
    this.passphrase = config.get('NETWORK_PASSPHRASE', { infer: true });
    this.usdcIssuer = config.get('USDC_ISSUER', { infer: true });
    const redisUrl = config.get('REDIS_URL', { infer: true });
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      } catch {
        this.redis = null;
      }
    }
  }

  get available(): boolean {
    return this.secret.startsWith('S') && this.secret.length >= 50;
  }

  status(): FaucetStatus {
    return { available: this.available, amountUsdc: this.amount };
  }

  /** Send the faucet amount of classic USDC to the user's primary wallet. */
  async claim(userId: string): Promise<{ txHash: string; amountUsdc: number; to: string }> {
    if (!this.available) {
      throw new ServiceUnavailableException(
        'The testnet USDC faucet is not enabled in this environment.',
      );
    }
    const address = await this.primaryAddress(userId);

    // Reserve the daily slot BEFORE sending so concurrent clicks can't double-claim;
    // release it if the transfer fails so the user can retry.
    const reserved = await this.reserve(userId);
    if (!reserved) {
      throw new BadRequestException(
        'You already claimed test USDC in the last 24 hours. Use what you have, or try again tomorrow.',
      );
    }
    try {
      const txHash = await this.sendUsdc(address);
      this.logger.log(`Faucet sent ${this.amount} USDC to ${address} (${txHash})`);
      return { txHash, amountUsdc: this.amount, to: address };
    } catch (err) {
      await this.release(userId);
      throw err;
    }
  }

  private async primaryAddress(userId: string): Promise<string> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { isPrimary: 'desc' },
      select: { address: true },
    });
    if (wallets.length === 0) {
      throw new NotFoundException('Connect a wallet before claiming test USDC.');
    }
    return wallets[0].address;
  }

  /** Returns true if the slot was free (and is now reserved for 24h). */
  private async reserve(userId: string): Promise<boolean> {
    const key = `faucet:claim:${userId}`;
    if (this.redis) {
      const ok = await this.redis.set(key, '1', 'EX', CLAIM_TTL_SECONDS, 'NX');
      return ok === 'OK';
    }
    const now = Date.now();
    const until = this.localClaims.get(userId);
    if (until && until > now) return false;
    this.localClaims.set(userId, now + CLAIM_TTL_SECONDS * 1000);
    return true;
  }

  private async release(userId: string): Promise<void> {
    const key = `faucet:claim:${userId}`;
    if (this.redis) {
      await this.redis.del(key).catch(() => undefined);
    } else {
      this.localClaims.delete(userId);
    }
  }

  private async sendUsdc(destination: string): Promise<string> {
    const kp = Keypair.fromSecret(this.secret);
    const server = new SorobanRpc.Server(this.rpcUrl, { allowHttp: false });
    const source = await server.getAccount(kp.publicKey()).catch(() => {
      throw new ServiceUnavailableException(
        'The faucet wallet is not funded on this network. Ask the operator to top it up.',
      );
    });
    const asset = new Asset('USDC', this.usdcIssuer);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(Operation.payment({ destination, asset, amount: this.amount.toFixed(7) }))
      .setTimeout(60)
      .build();
    tx.sign(kp);

    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      let reason = 'rejected';
      try {
        reason = response.errorResult?.result().switch().name ?? reason;
      } catch {
        // keep the generic reason
      }
      if (/underfunded|txInsufficientBalance|no_trust|LowReserve/i.test(reason)) {
        throw new ServiceUnavailableException(
          'The faucet wallet is temporarily out of USDC. Ask the operator to top it up.',
        );
      }
      throw new ServiceUnavailableException(`The faucet transfer was rejected (${reason}).`);
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        // The commonest cause is the destination missing the USDC trustline.
        throw new BadRequestException(
          'The faucet transfer failed. Add the USDC trustline to your wallet first, then try again.',
        );
      }
    }
    throw new ServiceUnavailableException(`The faucet transfer timed out: ${response.hash}`);
  }
}
