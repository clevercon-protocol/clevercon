import { LimitsManager } from './limits';

/**
 * Spending limits get their own tab: the rules are a distinct concept from the
 * money (Vault) and the command surface (Home). Each instruction you give the
 * agent carries its own limit, enforced on-chain per task; you build reusable
 * rules here and pick one per instruction, optionally marking one as the default.
 */
export function LimitsPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm leading-relaxed text-slate-400">
        Every instruction you give your agent carries its own limit, enforced on-chain by the vault
        (it is bound per task, so nothing is truly global). Build reusable limits here, then pick one
        per instruction on Home. Star one to make it your default: it pre-fills each new instruction,
        and you can still override it every time.
      </div>
      <LimitsManager />
    </div>
  );
}
