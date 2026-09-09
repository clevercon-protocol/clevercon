import { isDemo } from '../../config';
import { StatsRow, VaultSummary, TasksCard, WalletCard } from './parts';

export function Overview() {
  return (
    <div className="space-y-6">
      <StatsRow />
      {!isDemo() && <WalletCard />}
      <div className="grid gap-6 lg:grid-cols-2">
        <VaultSummary />
        <TasksCard limit={4} />
      </div>
    </div>
  );
}
