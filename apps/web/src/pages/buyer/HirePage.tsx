import { HirePanel, Marketplace } from './parts';

/**
 * The one place to find and pay a service: start a job (choose a provider or let
 * a delegate compose one, with an optional spending limit) above, and browse the
 * directory below.
 */
export function HirePage() {
  return (
    <div className="space-y-6">
      <HirePanel />
      <Marketplace />
    </div>
  );
}
