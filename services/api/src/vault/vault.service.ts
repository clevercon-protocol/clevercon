import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import { Prisma } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultContractService } from './vault-contract.service.js';
import { DelegateService } from './delegate.service.js';

const ZERO = new Prisma.Decimal(0);

function n(d: Prisma.Decimal): number {
  return Number(d);
}

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contract: VaultContractService,
    private readonly delegates: DelegateService,
  ) {}

  /** Deposit availability + the deployed contract address (for UI transparency). */
  get status(): { depositsEnabled: boolean; contractAddress: string } {
    return {
      depositsEnabled: this.contract.active,
      contractAddress: this.contract.contractAddress,
    };
  }

  private async primaryAddress(userId: string): Promise<string> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { isPrimary: 'desc' },
      select: { address: true },
    });
    if (wallets.length === 0) throw new NotFoundException('No wallet on this account');
    return wallets[0].address;
  }

  /** Build an unsigned deposit XDR for the caller's wallet to sign. */
  async buildDeposit(userId: string, amountUsdc: number) {
    if (amountUsdc <= 0) throw new BadRequestException('Amount must be positive');
    const address = await this.primaryAddress(userId);
    const xdr = await this.contract.buildDepositXdr(address, amountUsdc);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** Build an unsigned withdraw XDR for the caller's wallet to sign. */
  async buildWithdraw(userId: string, amountUsdc: number) {
    if (amountUsdc <= 0) throw new BadRequestException('Amount must be positive');
    const address = await this.primaryAddress(userId);
    const xdr = await this.contract.buildWithdrawXdr(address, amountUsdc);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** Submit a wallet-signed vault XDR; returns the on-chain tx hash. */
  async submit(signedXdr: string) {
    const txHash = await this.contract.submitSignedXdr(signedXdr);
    return { txHash };
  }

  /**
   * The caller's spending delegate (provisioned on first read) plus whether
   * settlement is enabled here and whether it has been authorized on-chain yet.
   */
  async getDelegate(userId: string) {
    const settlementEnabled = this.contract.active && this.delegates.available;
    if (!settlementEnabled) {
      return { orchestrator: null, settlementEnabled: false, registered: false };
    }
    const d = await this.delegates.getOrProvision(userId);
    return { orchestrator: d.publicKey, settlementEnabled: true, registered: d.registered };
  }

  /**
   * Build the one-time register_orchestrator XDR authorizing the caller's own
   * delegate. User-custodied (the user signs, the API submits via `submit`).
   */
  async buildRegisterOrchestrator(userId: string) {
    const address = await this.primaryAddress(userId);
    const { publicKey } = await this.delegates.getOrProvision(userId);
    const xdr = await this.contract.buildRegisterOrchestratorXdr(address, publicKey);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** Mark the caller's delegate as authorized (called after the register tx submits). */
  /**
   * The user's registered agent key (for the agent-key payment mode). Returns
   * only the public key; the platform never holds the secret.
   */
  async getAgentWallet(userId: string): Promise<{ publicKey: string | null }> {
    const w = await this.prisma.agentWallet.findUnique({ where: { userId } });
    return { publicKey: w?.publicKey ?? null };
  }

  /**
   * Register (or update) the user's OWN agent key. We store only the public
   * key: the user's agent holds the secret and signs its own payments, so this
   * stays non-custodial. The vault will top this address up in bounded amounts
   * under the user's policy (agent-key mode, paying external x402/MPP services).
   */
  async setAgentWallet(userId: string, publicKey: string): Promise<{ publicKey: string }> {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new BadRequestException('Invalid Stellar public key (expected a G... address)');
    }
    const w = await this.prisma.agentWallet.upsert({
      where: { userId },
      create: { userId, publicKey },
      update: { publicKey },
    });
    return { publicKey: w.publicKey };
  }

  async confirmDelegateRegistered(userId: string) {
    await this.delegates.markRegistered(userId);
    return { ok: true as const };
  }

  /**
   * Aggregate the vault position for a user across every wallet they control.
   * On-chain is the source of truth; these rows are the indexed mirror, so a
   * user with no deposits yet simply reads back zeros.
   */
  async getForUser(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { address: true },
    });
    const addresses = wallets.map((w) => w.address);
    if (addresses.length === 0) {
      return {
        balance: 0,
        available: 0,
        locked: 0,
        totalDeposited: 0,
        totalSpent: 0,
        accounts: [],
      };
    }

    // The app denominates the vault in USDC. Filter to the configured USDC asset
    // so we never sum balances across different assets (e.g. a legacy XLM
    // position + a USDC position) into one misleading number.
    const where: { address: { in: string[] }; asset?: string } = { address: { in: addresses } };
    if (this.contract.usdcAsset) where.asset = this.contract.usdcAsset;

    const rows = await this.prisma.vaultAccount.findMany({
      where,
      orderBy: { balance: 'desc' },
    });

    let balance = ZERO;
    let locked = ZERO;
    let totalDeposited = ZERO;
    let totalSpent = ZERO;
    for (const r of rows) {
      balance = balance.add(r.balance);
      locked = locked.add(r.locked);
      totalDeposited = totalDeposited.add(r.totalDeposited);
      totalSpent = totalSpent.add(r.totalSpent);
    }

    return {
      balance: n(balance),
      available: n(balance.sub(locked)),
      locked: n(locked),
      totalDeposited: n(totalDeposited),
      totalSpent: n(totalSpent),
      accounts: rows.map((r) => ({
        address: r.address,
        asset: r.asset,
        balance: n(r.balance),
        available: n(r.balance.sub(r.locked)),
        locked: n(r.locked),
        activeTasks: r.activeTasks,
      })),
    };
  }
}
