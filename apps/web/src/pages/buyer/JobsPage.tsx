import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TasksCard } from './parts';

export function JobsPage() {
  return (
    <div className="space-y-4">
      <TasksCard />
      <Link
        to="/app/activity"
        className="inline-flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200"
      >
        View full activity <ArrowRight size={14} />
      </Link>
    </div>
  );
}
