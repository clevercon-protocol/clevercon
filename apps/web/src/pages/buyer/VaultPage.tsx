import { isDemo } from '../../config';
import {
  WalletCard,
  VaultCard,
  DelegateCard,
  AgentWalletCard,
  ManagedSessionCard,
  ProveReleaseCard,
} from './parts';
import { SectionLabel } from '../../components/ui';

/**
 * Money and hands-off spending in one place: fund the non-custodial vault, read
 * the live on-chain balance, authorize a bounded Managed Session for hands-off
 * public spending, and register the settlement relayer. Rules live on their own
 * tab; the agent command surface is Home.
 */
export function VaultPage() {
  return (
    <div className="cc-stagger max-w-5xl space-y-7">
      <header>
        <p className="cc-eyebrow">Money</p>
        <h1 className="cc-title mt-2">Vault</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Your funds stay in your own non-custodial vault on Stellar. Fund it, then authorize
          hands-off spending with a bounded, revocable Managed Session. Every balance here is read
          live from the active vault on-chain.
        </p>
      </header>

      {!isDemo() && <WalletCard />}

      <div className="grid gap-6 lg:grid-cols-2">
        <VaultCard />
        {!isDemo() && <ManagedSessionCard />}
      </div>

      {!isDemo() && (
        <div>
          <SectionLabel>Keys &amp; relaying</SectionLabel>
          <div className="mt-2 grid gap-6 lg:grid-cols-2">
            <DelegateCard />
            <AgentWalletCard />
          </div>
        </div>
      )}

      <div className="max-w-3xl">
        <ProveReleaseCard />
      </div>
    </div>
  );
}
