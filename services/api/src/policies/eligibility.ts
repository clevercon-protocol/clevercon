/**
 * Soft marketplace eligibility: a user's curation of which services their agent may
 * use, enforced by the app at hire time. This is NON-sensitive (it is not part of
 * the ZK spend rule), so it is stored in cleartext for both the private and public
 * lanes. The HARD guarantee is still the on-chain payee allowlist/denylist (R3/R4)
 * the vault enforces; this is the convenience filter layered on top.
 */
export interface EligibilityRules {
  /** Only services whose verification tier is in this set are allowed (empty = any). */
  allowedTiers?: string[];
  /** Only these service ids are allowed (empty/absent = any, subject to deny). */
  serviceAllow?: string[];
  /** These service ids are blocked outright (wins over allow). */
  serviceDeny?: string[];
}

export interface EligibilityCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Decide whether a service may be hired under a rule's eligibility. Pure and
 * order-sensitive: deny wins, then an allow-list (if non-empty) must include it,
 * then its tier must be permitted. Absent/empty eligibility permits everything.
 */
export function checkEligibility(
  e: EligibilityRules | null | undefined,
  svc: { id: string; tier: string },
): EligibilityCheck {
  if (!e) return { ok: true };
  if (e.serviceDeny?.includes(svc.id)) {
    return { ok: false, reason: 'this service is on your blocked list' };
  }
  if (e.serviceAllow && e.serviceAllow.length > 0 && !e.serviceAllow.includes(svc.id)) {
    return { ok: false, reason: 'this service is not on your allowed list' };
  }
  if (e.allowedTiers && e.allowedTiers.length > 0 && !e.allowedTiers.includes(svc.tier)) {
    return { ok: false, reason: `this service's verification tier (${svc.tier}) is not allowed` };
  }
  return { ok: true };
}
