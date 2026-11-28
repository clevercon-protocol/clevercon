import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { UsersService } from './users.service.js';

type Ctor = ConstructorParameters<typeof UsersService>;
const hash = (c: string) => createHash('sha256').update(c).digest('hex');

function make(opts: { user?: Record<string, unknown> | null; mailerEnabled?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const sent: unknown[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(async () => opts.user ?? null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: 'u1', ...data };
      }),
    },
  } as unknown as Ctor[0];
  const mailer = {
    enabled: opts.mailerEnabled ?? false,
    send: vi.fn(async (m: unknown) => {
      sent.push(m);
      return true;
    }),
  } as unknown as Ctor[1];
  return { svc: new UsersService(prisma, mailer), updates, sent };
}

describe('UsersService email verification', () => {
  it('setEmail stores a HASHED code (never plaintext) and sends when enabled', async () => {
    const { svc, updates, sent } = make({ mailerEnabled: true });
    const res = await svc.setEmail('u1', '  USER@Example.com ');
    expect(res.email).toBe('user@example.com'); // trimmed + lowercased
    expect(res.verificationSent).toBe(true);
    const data = updates[0] as { emailVerifyCode: string; emailVerified: boolean };
    expect(data.emailVerified).toBe(false);
    // Stored value is a sha256 hex, not a 6-digit code.
    expect(data.emailVerifyCode).toMatch(/^[a-f0-9]{64}$/);
    expect(sent).toHaveLength(1);
  });

  it('setEmail saves the address but sends nothing when mail is disabled', async () => {
    const { svc, sent } = make({ mailerEnabled: false });
    const res = await svc.setEmail('u1', 'user@example.com');
    expect(res.verificationSent).toBe(false);
    expect(res.emailDelivery).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('verifyEmail accepts the correct, unexpired code and marks verified', async () => {
    const { svc, updates } = make({
      user: {
        emailVerifyCode: hash('123456'),
        emailVerifyExpires: new Date(Date.now() + 60_000),
      },
    });
    const res = await svc.verifyEmail('u1', '123456');
    expect(res.verified).toBe(true);
    expect(updates[0]).toMatchObject({ emailVerified: true, emailVerifyCode: null });
  });

  it('verifyEmail rejects a wrong code', async () => {
    const { svc } = make({
      user: {
        emailVerifyCode: hash('123456'),
        emailVerifyExpires: new Date(Date.now() + 60_000),
      },
    });
    await expect(svc.verifyEmail('u1', '000000')).rejects.toThrow(/not correct/i);
  });

  it('verifyEmail rejects an expired code', async () => {
    const { svc } = make({
      user: {
        emailVerifyCode: hash('123456'),
        emailVerifyExpires: new Date(Date.now() - 1000),
      },
    });
    await expect(svc.verifyEmail('u1', '123456')).rejects.toThrow(/expired/i);
  });

  it('verifyEmail rejects when there is no pending verification', async () => {
    const { svc } = make({ user: { emailVerifyCode: null, emailVerifyExpires: null } });
    await expect(svc.verifyEmail('u1', '123456')).rejects.toThrow(/no pending/i);
  });
});
