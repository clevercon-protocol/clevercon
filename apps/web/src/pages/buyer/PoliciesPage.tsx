import { PoliciesCard, ProveReleaseCard } from './parts';

export function PoliciesPage() {
  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <PoliciesCard />
      <ProveReleaseCard />
    </div>
  );
}
