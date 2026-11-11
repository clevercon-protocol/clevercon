import { isDemo } from '../config';
import { apiGet, apiPost, apiPatch } from './api';

/** An org the caller may list services under. */
export interface OrgRef {
  id: string;
  handle: string;
  name: string;
  verified: boolean;
  role?: string;
}

export interface ProfileLinks {
  website?: string;
  docs?: string;
  support?: string;
  github?: string;
  x?: string;
  discord?: string;
}

/** The caller's own provider profile + the orgs they belong to. */
export interface MyProfile {
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  links: ProfileLinks | null;
  verified: boolean;
  orgs: OrgRef[];
}

export interface ProfileCardService {
  id: string;
  name: string;
  category: string | null;
  tier: string;
  pricePerCall: number;
  status: string;
}

/** A public profile page: an org or an individual provider, with their services. */
export interface PublicProfile {
  type: 'org' | 'user';
  handle: string;
  name: string;
  bio: string | null;
  links: ProfileLinks | null;
  verified: boolean;
  services: ProfileCardService[];
}

export interface OrgInput {
  name: string;
  handle: string;
  bio?: string;
  links?: ProfileLinks;
}
export interface ProfileInput {
  displayName?: string;
  handle?: string;
  bio?: string;
  links?: ProfileLinks;
}

const EMPTY_PROFILE: MyProfile = {
  displayName: null,
  handle: null,
  bio: null,
  links: null,
  verified: false,
  orgs: [],
};

export async function getMyProfile(): Promise<MyProfile> {
  if (isDemo()) return EMPTY_PROFILE;
  return apiGet<MyProfile>('/me/profile');
}
export async function updateMyProfile(patch: ProfileInput): Promise<MyProfile> {
  return apiPatch<MyProfile>('/me/profile', patch);
}
export async function getMyOrgs(): Promise<OrgRef[]> {
  if (isDemo()) return [];
  return apiGet<OrgRef[]>('/orgs/mine');
}
export async function createOrg(input: OrgInput): Promise<OrgRef> {
  return apiPost<OrgRef>('/orgs', input);
}
export async function updateOrg(id: string, patch: Partial<OrgInput>): Promise<OrgRef> {
  return apiPatch<OrgRef>(`/orgs/${id}`, patch);
}
export async function getPublicProfile(handle: string): Promise<PublicProfile> {
  return apiGet<PublicProfile>(`/profiles/${encodeURIComponent(handle)}`);
}
