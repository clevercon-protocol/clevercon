import { isDemo } from '../../config';
import { WalletCard, VaultCard, DelegateCard, AgentWalletCard, ProveReleaseCard } from './parts';
import { LimitsManager } from './limits';

/**
 * Money and account setup in one place: fund the vault, authorize autopay,
 * register an agent wallet, and manage reusable spending limits (policies).
 */
export function VaultPage() {
  return (
    <div className="space-y-6">
      {!isDemo() && <WalletCard />}
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <VaultCard />
        <DelegateCard />
      </div>
      {!isDemo() && (
        <div className="max-w-4xl">
          <AgentWalletCard />
        </div>
      )}
      <div className="max-w-4xl space-y-6">
        <LimitsManager />
        <ProveReleaseCard />
      </div>
    </div>
  );
}
