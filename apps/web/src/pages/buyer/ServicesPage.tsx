import { Marketplace } from './parts';

/**
 * Services directory: browse and sort the services an agent can hire, by category
 * and payment method. A reference section, not the center of the app (the agent
 * pulls from here; you can also hire directly from a service's detail page).
 */
export function ServicesPage() {
  return <Marketplace />;
}
