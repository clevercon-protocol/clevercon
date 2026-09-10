import { isDemo } from '../../config';
import { WalletCard, VaultCard, DelegateCard } from './parts';

export function VaultPage() {
  return (
    <div className="space-y-6">
      {!isDemo() && <WalletCard />}
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <VaultCard />
        <DelegateCard />
      </div>
    </div>
  );
}
