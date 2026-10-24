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

  /**
   * Build the `set_policy_commitment` XDR pinning a rule's commitment to the
   * caller's account. User-custodied: the wallet signs, the API submits via
   * `submit`. Required before the proof-gated path will accept the rule.
   */
  async buildPinCommitment(userId: string, commitmentHex: string) {
    const address = await this.primaryAddress(userId);
    const xdr = await this.contract.buildPinCommitmentXdr(address, commitmentHex);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** Build the wallet-signed unpin_policy_commitment XDR (removes it from the pinned set). */
  async buildUnpinCommitment(userId: string, commitmentHex: string) {
    const address = await this.primaryAddress(userId);
    const xdr = await this.contract.buildUnpinCommitmentXdr(address, commitmentHex);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** The user's on-chain pinned-commitment set (hex), so the dapp can mark which rules are live. */
  async getPinnedCommitments(userId: string): Promise<{ commitments: string[] }> {
    if (!this.contract.active) return { commitments: [] };
    const address = await this.primaryAddress(userId).catch(() => null);
    if (!address) return { commitments: [] };
    try {
      return { commitments: await this.contract.readPolicyCommitments(address) };
    } catch {
      return { commitments: [] };
    }
  }

  /**
   * The per-commitment R2/R7 accumulator the client reads before proving a pp/2
   * batch (so the proof binds to the window state the vault re-derives). Pure
   * read; no auth needed beyond the API key (the commitment is already public).
   */
  async getCommitmentAccumulator(commitmentHex: string) {
    return this.contract.readCommitmentAccum(commitmentHex);
  }

  /**
   * Managed Sessions (server + public lane). The user's server-held delegate IS
   * the session key: the owner signs register_session ONCE (wallet-signed, via
   * `submit`) to authorize the on-chain scope (budget + payee allowlist + expiry),
   * then `sessionPay` spends hands-off with the server signing as that delegate.
   * The vault enforces the scope, so even the server cannot exceed it; revoke is
   * wallet-signed and instant. This is the dapp's public option (a browser key
   * could not sign hands-off), replacing the old server-logic Autopay.
   */
  async buildEnableSession(
    userId: string,
    budgetUsdc: number,
    allowlist: string[],
    expiresInSeconds: number,
  ) {
    if (budgetUsdc <= 0) throw new BadRequestException('budgetUsdc must be positive');
    if (allowlist.length < 1 || allowlist.length > 32) {
      throw new BadRequestException('allowlist must have 1..32 payees');
    }
    if (expiresInSeconds <= 0) throw new BadRequestException('expiresInSeconds must be positive');
    for (const a of allowlist) {
      if (!StrKey.isValidEd25519PublicKey(a)) throw new BadRequestException(`invalid payee: ${a}`);
    }
    if (!this.delegates.available) {
      throw new BadRequestException('Managed Sessions are not configured on this deployment');
    }
    const address = await this.primaryAddress(userId);
    const { publicKey } = await this.delegates.getOrProvision(userId);
    const expiry = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const xdr = await this.contract.buildRegisterSessionXdr(
      address,
      publicKey,
      budgetUsdc,
      expiry,
      allowlist,
    );
    return {
      xdr,
      networkPassphrase: this.contract.passphrase,
      sessionPublicKey: publicKey,
      expiry,
    };
  }

  /**
   * Hands-off public-lane spend: the server signs release_payment_session with the
   * caller's delegate/session key. No per-payment wallet signature (that is the
   * point); the vault's on-chain scope is the whole protection.
   */
  async sessionPay(userId: string, payee: string, amountUsdc: number) {
    if (amountUsdc <= 0) throw new BadRequestException('amount must be positive');
    if (!StrKey.isValidEd25519PublicKey(payee)) throw new BadRequestException('invalid payee');
    const kp = await this.delegates.keypairFor(userId);
    if (!kp) throw new BadRequestException('No managed session: enable one first');
    const txHash = await this.contract.releaseViaSession(kp, payee, amountUsdc);
    return { txHash };
  }

  /**
   * Submit a KEYLESS, proof-authorized private release for the caller. The user's
   * address comes from their authenticated session (never the request body), so a
   * caller can only ever spend from their OWN vault; the proof + the user's pinned
   * commitment gate it on-chain regardless. No delegate, no per-payment signature:
   * the relayer only pays the fee. Returns the on-chain tx hash.
   */
  async releaseKeyless(
    userId: string,
    params: {
      commitmentHex: string;
      payees: string[];
      amountsStroops: bigint[];
      nullifiers: Buffer[];
      validAfter: bigint;
      validBefore: bigint;
      resetR2: boolean;
      resetR7: boolean;
      proof: { a: Buffer; b: Buffer; c: Buffer };
      global?: {
        commitmentHex: string;
        nullifiers: Buffer[];
        resetR2: boolean;
        resetR7: boolean;
        proof: { a: Buffer; b: Buffer; c: Buffer };
      } | null;
    },
  ): Promise<{ txHash: string }> {
    const user = await this.primaryAddress(userId);
    const txHash = await this.contract.releaseProvedKeyless({ user, ...params });
    return { txHash };
  }

  /** Build the wallet-signed revoke_session XDR (kills the managed session on-chain). */
  async buildRevokeSession(userId: string) {
    const address = await this.primaryAddress(userId);
    const publicKey = await this.delegates.publicKeyFor(userId);
    if (!publicKey) throw new BadRequestException('No managed session to revoke');
    const xdr = await this.contract.buildRevokeSessionXdr(address, publicKey);
    return { xdr, networkPassphrase: this.contract.passphrase };
  }

  /** The caller's live managed-session scope (budget/allowlist/expiry), or null. */
  async getSession(userId: string) {
    const publicKey = await this.delegates.publicKeyFor(userId);
    if (!publicKey) return { sessionPublicKey: null, session: null };
    const session = await this.contract.readSession(publicKey);
    return { sessionPublicKey: publicKey, session };
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
      orderBy: { isPrimary: 'desc' },
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

    // Authoritative headline: the primary wallet's position read live from the
    // ACTIVE vault. The mirror below is keyed by (address, asset) not by vault id,
    // so after a cutover it can report a stale balance from an old vault; on-chain
    // is the source of truth. Fall back to the mirror only if the read is
    // unavailable (RPC blip / inactive contract).
    if (this.contract.active) {
      try {
        const onchain = await this.contract.readUserAccount(addresses[0]);
        if (onchain) {
          return {
            balance: onchain.balance,
            available: onchain.available,
            locked: onchain.locked,
            totalDeposited: onchain.totalDeposited,
            totalSpent: onchain.totalSpent,
            accounts: [
              {
                address: addresses[0],
                asset: this.contract.usdcAsset,
                balance: onchain.balance,
                available: onchain.available,
                locked: onchain.locked,
                activeTasks: 0,
              },
            ],
          };
        }
        // No account in this vault yet: honest zeros (not a stale mirror balance).
        return {
          balance: 0,
          available: 0,
          locked: 0,
          totalDeposited: 0,
          totalSpent: 0,
          accounts: [],
        };
      } catch {
        // fall through to the mirror
      }
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
