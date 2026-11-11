// Resolves WHO lists a service, for display on the card, detail page, and profile.
// A service owned by an org shows the org; otherwise the registering provider's
// public profile (display name or handle), falling back to a shortened wallet.

export interface OwnerView {
  type: 'org' | 'user';
  id: string;
  handle: string | null;
  name: string;
  verified: boolean;
  links?: unknown;
}

/** Narrow shapes so this works with whatever the query selected. */
export interface ProviderProfile {
  id: string;
  displayName: string | null;
  handle: string | null;
  verified: boolean;
  links?: unknown;
}
export interface OrgProfile {
  id: string;
  name: string;
  handle: string;
  verified: boolean;
  links?: unknown;
}

function shortAddr(addr?: string | null): string {
  if (!addr) return 'Unknown provider';
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function ownerOf(s: {
  provider?: ProviderProfile | null;
  ownerOrg?: OrgProfile | null;
  stellarAddress?: string | null;
}): OwnerView | null {
  if (s.ownerOrg) {
    return {
      type: 'org',
      id: s.ownerOrg.id,
      handle: s.ownerOrg.handle,
      name: s.ownerOrg.name,
      verified: s.ownerOrg.verified,
      links: s.ownerOrg.links ?? undefined,
    };
  }
  if (s.provider) {
    const name =
      s.provider.displayName ||
      (s.provider.handle ? `@${s.provider.handle}` : shortAddr(s.stellarAddress));
    return {
      type: 'user',
      id: s.provider.id,
      handle: s.provider.handle,
      name,
      verified: s.provider.verified,
      links: s.provider.links ?? undefined,
    };
  }
  return null;
}

/** The select used anywhere a service needs its owner resolved. */
export const OWNER_INCLUDE = {
  provider: { select: { id: true, displayName: true, handle: true, verified: true, links: true } },
  ownerOrg: { select: { id: true, name: true, handle: true, verified: true, links: true } },
} as const;
