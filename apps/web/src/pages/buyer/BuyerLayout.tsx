import { Outlet, useLocation } from 'react-router-dom';
import { useRealtime } from '../../lib/useRealtime';

/**
 * Buyer console shell. The navigation now lives in the app rail (components/
 * Shell), so this just wires realtime updates and renders the active sub-page,
 * keyed on the path so the entrance animation replays per screen.
 */
export function BuyerLayout() {
  useRealtime();
  const location = useLocation();
  return (
    <div key={location.pathname} className="cc-page">
      <Outlet />
    </div>
  );
}
