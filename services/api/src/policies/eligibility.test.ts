import { describe, it, expect } from 'vitest';
import { checkEligibility } from './eligibility.js';

const svc = { id: 'svc-1', tier: 'T2' };

describe('checkEligibility', () => {
  it('permits everything when eligibility is absent or empty', () => {
    expect(checkEligibility(null, svc).ok).toBe(true);
    expect(checkEligibility({}, svc).ok).toBe(true);
    expect(checkEligibility({ serviceAllow: [], allowedTiers: [] }, svc).ok).toBe(true);
  });

  it('blocks a denied service (deny wins)', () => {
    const r = checkEligibility({ serviceDeny: ['svc-1'], serviceAllow: ['svc-1'] }, svc);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('blocked');
  });

  it('blocks a service not on a non-empty allow list', () => {
    const r = checkEligibility({ serviceAllow: ['svc-2'] }, svc);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('allowed list');
  });

  it('permits a service that is on the allow list', () => {
    expect(checkEligibility({ serviceAllow: ['svc-1', 'svc-2'] }, svc).ok).toBe(true);
  });

  it('blocks a service whose tier is not permitted', () => {
    const r = checkEligibility({ allowedTiers: ['T1'] }, svc);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('tier');
  });

  it('permits a service whose tier is permitted', () => {
    expect(checkEligibility({ allowedTiers: ['T1', 'T2'] }, svc).ok).toBe(true);
  });
});
