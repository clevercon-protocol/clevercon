import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { encryptSecret, decryptSecret, secretCryptoAvailable } from '@clevercon/db';
import type { AppEnv } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Provisions and manages each user's spending delegate (the orchestrator they
 * authorize on the vault). The secret is generated server-side, encrypted at
 * rest (AES-GCM via @clevercon/db), and only ever decrypted to sign the user's
 * own locks and releases. The delegate is bounded by the vault policy, so it can
 * never overspend; it holds only a little XLM for fees, never user funds.
 *
 * Per-user keys are required because the vault's orchestrator->owner mapping is
 * 1:1, so a single shared delegate could only serve one user.
 */
@Injectable()
export class DelegateService {
  private readonly logger = new Logger(DelegateService.name);
  private readonly network: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.network = config.get('NETWORK', { infer: true });
    // The shared @clevercon/db crypto util reads the key from process.env; the
    // API's validated config does not populate process.env, so bridge it here.
    const key = config.get('DELEGATE_ENCRYPTION_KEY', { infer: true });
    if (key && !process.env.DELEGATE_ENCRYPTION_KEY) process.env.DELEGATE_ENCRYPTION_KEY = key;
  }

  /** Whether delegate provisioning is possible (encryption key configured). */
  get available(): boolean {
    return secretCryptoAvailable();
  }

  /**
   * Return the user's delegate, provisioning one on first use: generate a
   * keypair, fund it for fees (friendbot on testnet), and store the encrypted
   * secret. Idempotent.
   */
  async getOrProvision(userId: string): Promise<{ publicKey: string; registered: boolean }> {
    if (!this.available) {
      throw new ServiceUnavailableException('Delegate provisioning is not configured');
    }
    const existing = await this.prisma.agentDelegate.findUnique({ where: { userId } });
    if (existing) return { publicKey: existing.publicKey, registered: existing.registered };

    const kp = Keypair.random();
    await this.fundForFees(kp.publicKey());
    const created = await this.prisma.agentDelegate.create({
      data: {
        userId,
        publicKey: kp.publicKey(),
        secretCipher: encryptSecret(kp.secret()),
      },
    });
    this.logger.log(`Provisioned delegate ${created.publicKey} for user ${userId}`);
    return { publicKey: created.publicKey, registered: false };
  }

  /** The user's delegate public key, or null if not provisioned yet. */
  async publicKeyFor(userId: string): Promise<string | null> {
    const d = await this.prisma.agentDelegate.findUnique({ where: { userId } });
    return d?.publicKey ?? null;
  }

  /** Decrypt the user's delegate into a signing keypair (for locks/releases). */
  async keypairFor(userId: string): Promise<Keypair | null> {
    const d = await this.prisma.agentDelegate.findUnique({ where: { userId } });
    if (!d) return null;
    return Keypair.fromSecret(decryptSecret(d.secretCipher));
  }

  /** Mark the delegate as registered once the user has authorized it on-chain. */
  async markRegistered(userId: string): Promise<void> {
    await this.prisma.agentDelegate.updateMany({
      where: { userId },
      data: { registered: true },
    });
  }

  /** Fund a fresh delegate with testnet XLM for transaction fees (best-effort). */
  private async fundForFees(publicKey: string): Promise<void> {
    if (this.network !== 'testnet') return; // mainnet funding is an ops concern
    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
      if (!res.ok) this.logger.warn(`friendbot funding returned ${res.status} for ${publicKey}`);
    } catch (err) {
      this.logger.warn(`friendbot funding failed for ${publicKey}: ${(err as Error).message}`);
    }
  }
}
