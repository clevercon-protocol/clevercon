import { useState } from 'react';
import { Eye, ChevronDown } from 'lucide-react';

/**
 * The "what the chain sees vs what you set" reveal: makes CleverCon's privacy and
 * custody model legible at the point of a payment. Tailored to how the payment was
 * authorized (the payment method), because the three lanes expose different things:
 *  - VAULT_RELEASE  private, proof-gated: the chain sees the payment + a ZK proof
 *                   your rule was satisfied (a commitment hash), never the rule.
 *  - SESSION        public managed session: the public rule is on-chain by design;
 *                   the chain enforces the cap + expiry you authorized.
 *  - X402 / MPP     metered: each per-call payment from your agent's own wallet,
 *                   bounded by your capped private allowance (not escrow).
 * Returns null for a method with nothing privacy-relevant to explain.
 */
export function PrivacyReveal({ method }: { method: string }) {
  const [open, setOpen] = useState(false);

  const content: { chain: string[]; you: string[] } | null = (() => {
    switch (method) {
      case 'VAULT_RELEASE':
        return {
          chain: [
            'The payment itself: amount, payee, time, and tx hash.',
            'A zero-knowledge proof that your spending rule was satisfied, carried as a commitment hash.',
          ],
          you: [
            'The rule itself: your caps, allow/deny list, categories, and windows.',
            "The rule's salt, kept on your device. The server never sees the rule plaintext and cannot reconstruct it.",
          ],
        };
      case 'SESSION':
        return {
          chain: [
            'The payment, plus the public rule it ran under (cleartext by design on this lane).',
            'The session scope you authorized: total cap and expiry, enforced on-chain.',
          ],
          you: [
            'Which public rule and session scope to authorize. The platform signs within it and can never exceed the cap or expiry.',
          ],
        };
      case 'X402':
      case 'MPP':
        return {
          chain: ['Each per-call payment from your agent’s own wallet.'],
          you: [
            'The capped private allowance your agent pulls from (on-chain enforced). Metered spend is bounded by that allowance, not held in per-job escrow.',
          ],
        };
      default:
        return null;
    }
  })();

  if (!content) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] text-violet-300 hover:text-violet-200"
      >
        <Eye size={12} className="shrink-0" />
        What the chain sees vs what you set
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 grid gap-3 rounded-lg bg-black/20 p-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              The chain sees
            </div>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-slate-400">
              {content.chain.map((c, i) => (
                <li key={i}>· {c}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">
              You set &amp; keep private
            </div>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-slate-400">
              {content.you.map((c, i) => (
                <li key={i}>· {c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
