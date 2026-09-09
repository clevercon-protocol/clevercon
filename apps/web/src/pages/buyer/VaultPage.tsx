import { isDemo } from '../../config';
import { WalletCard, VaultCard } from './parts';

export function VaultPage() {
  return (
    <div className="space-y-6">
      {!isDemo() && <WalletCard />}
      <div className="max-w-xl">
        <VaultCard />
      </div>
    </div>
  );
}
