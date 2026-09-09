import { HirePanel, TasksCard } from './parts';

export function JobsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <HirePanel />
      <TasksCard />
    </div>
  );
}
