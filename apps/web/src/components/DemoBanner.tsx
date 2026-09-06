import { isDemo } from '../config';

export function DemoBanner() {
  if (!isDemo()) return null;
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs text-center py-1.5">
      Demo mode. Wallet and backend features are simulated; no real funds or network calls.
    </div>
  );
}
