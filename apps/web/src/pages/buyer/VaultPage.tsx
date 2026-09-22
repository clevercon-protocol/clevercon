import { isDemo } from '../../config';
import { WalletCard, VaultCard, DelegateCard, AgentWalletCard, ProveReleaseCard } from './parts';

/**
 * Money and accounts in one place: fund the vault, authorize autopay, and
 * register an agent wallet. Spending limits live on their own tab (Limits).
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
      <div className="max-w-4xl">
        <ProveReleaseCard />
      </div>
    </div>
  );
}
