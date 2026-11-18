/**
 * Shared logic for a service's usage requirements (Service.prerequisites) and what a
 * buyer has satisfied (ServiceSetup). Used by both the setup API (ServicesService) and
 * the pre-hire gate (TasksService), so the "is this satisfied" rule lives in one place.
 */
import { decryptSecret } from '@clevercon/db';
import type { Prerequisite } from '@clevercon/common';

export interface SetupRow {
  data?: unknown;
  secretCipher?: string | null;
}

/** The set of prerequisite keys a buyer has satisfied for a service. Non-secret values
 *  live in `data`; secret values (API keys/tokens) are decrypted from `secretCipher`. */
export function satisfiedKeys(setup: SetupRow | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!setup) return keys;
  const add = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && v !== '') keys.add(k);
    }
  };
  if (setup.data && typeof setup.data === 'object') add(setup.data as Record<string, unknown>);
  if (setup.secretCipher) {
    try {
      add(JSON.parse(decryptSecret(setup.secretCipher)) as Record<string, unknown>);
    } catch {
      // A corrupt / rotated cipher just means those secrets count as not satisfied.
    }
  }
  return keys;
}

/** The required prerequisites the buyer has NOT satisfied (empty = cleared to hire). */
export function unmetPrerequisites(
  prerequisites: Prerequisite[] | null | undefined,
  satisfied: Set<string>,
): Prerequisite[] {
  if (!Array.isArray(prerequisites) || prerequisites.length === 0) return [];
  return prerequisites.filter((p) => p && p.key && !satisfied.has(p.key));
}

/** A one-line, user-facing message naming what still needs setting up. */
export function unmetMessage(unmet: Prerequisite[]): string {
  const names = unmet.map((p) => p.label || p.key).join(', ');
  return `This service requires setup first: ${names}. Set it up on the service page, then hire again.`;
}
