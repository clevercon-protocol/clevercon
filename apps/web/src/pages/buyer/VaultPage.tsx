import { isDemo } from '../../config';
import {
  WalletCard,
  QuickstartCard,
  VaultCard,
  AgentWalletCard,
  ManagedSessionCard,
} from './parts';
import { AgentKeysCard } from './AgentKeysCard';
import { SectionLabel } from '../../components/ui';

/**
 * Money and hands-off spending in one place: fund the non-custodial vault, read the
 * live on-chain balance, and authorize a bounded Managed Session for hands-off public
 * spending. Private spending is keyless (no key to register, no per-payment
 * signature), so there is nothing to set up here for it. Rules live on their own tab;
 * the agent command surface is Home.
 */
export function VaultPage() {
  return (
    <div className="cc-stagger max-w-5xl space-y-7">
      <header>
        <p className="cc-eyebrow">Money</p>
        <h1 className="cc-title mt-2">Vault</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Your funds stay in your own non-custodial vault on Stellar. Fund it, then spend privately
          (keyless, no setup) or authorize a bounded, revocable Managed Session for hands-off public
          spending. Every balance here is read live from the active vault on-chain.
        </p>
      </header>

      {!isDemo() && <WalletCard />}
      {!isDemo() && <QuickstartCard />}

      <div className="grid gap-6 lg:grid-cols-2">
        <VaultCard />
        {!isDemo() && <ManagedSessionCard />}
      </div>

      {!isDemo() && (
        <div>
          <SectionLabel>Self-custody agent keys (public lane, local mode)</SectionLabel>
          <div className="mt-2">
            <AgentKeysCard />
          </div>
        </div>
      )}

      {!isDemo() && (
        <div>
          <SectionLabel>Your agent key (for metered x402 / MPP services)</SectionLabel>
          <div className="mt-2 grid gap-6 lg:grid-cols-2">
            <AgentWalletCard />
          </div>
        </div>
      )}
    </div>
  );
}
