import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageService } from './storage.service.js';

const R2_ENV = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
] as const;

describe('StorageService', () => {
  beforeEach(() => R2_ENV.forEach((k) => delete process.env[k]));
  afterEach(() => R2_ENV.forEach((k) => delete process.env[k]));

  function configure(publicUrl = false) {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'AKIATEST';
    process.env.R2_SECRET_ACCESS_KEY = 'secretkey';
    process.env.R2_BUCKET = 'clevercon';
    if (publicUrl) process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com/';
  }

  it('is disabled until the R2 env is set', () => {
    const s = new StorageService();
    expect(s.enabled()).toBe(false);
    configure();
    expect(s.enabled()).toBe(true);
  });

  it('namespaces + sanitises the object key', () => {
    const s = new StorageService();
    const key = s.objectKey('user-1', 'My Report (final)!.pdf');
    expect(key.startsWith('uploads/user-1/')).toBe(true);
    expect(key.endsWith('_final_.pdf') || key.endsWith('_.pdf')).toBe(true);
    expect(key).not.toMatch(/[ ()!]/); // unsafe chars stripped
  });

  it('presigns a PUT with the SigV4 query params and correct host/path', () => {
    configure();
    const s = new StorageService();
    const url = s.presignPut('uploads/u1/abc-file.pdf', 300, new Date('2026-10-16T13:00:00Z'));
    expect(
      url.startsWith('https://acct123.r2.cloudflarestorage.com/clevercon/uploads/u1/abc-file.pdf?'),
    ).toBe(true);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=AKIATEST%2F20261016%2Fauto%2Fs3%2Faws4_request');
    expect(url).toContain('X-Amz-Date=20261016T130000Z');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toMatch(/X-Amz-Signature=[a-f0-9]{64}$/);
  });

  it('is deterministic for a fixed time + inputs', () => {
    configure();
    const s = new StorageService();
    const at = new Date('2026-10-16T13:00:00Z');
    expect(s.presignPut('uploads/u1/f', 300, at)).toBe(s.presignPut('uploads/u1/f', 300, at));
  });

  it('returns a public URL only when the bucket is public', () => {
    const s = new StorageService();
    configure(false);
    expect(s.publicUrl('uploads/u1/f.pdf')).toBeNull();
    configure(true);
    expect(s.publicUrl('uploads/u1/f.pdf')).toBe('https://cdn.example.com/uploads/u1/f.pdf');
  });
});
