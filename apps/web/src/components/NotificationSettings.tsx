import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Mail, Trash2 } from 'lucide-react';
import {
  getMeEmail,
  setEmail,
  verifyEmail,
  removeEmail,
  getNotificationPreferences,
  setNotificationPreference,
} from '../lib/account';

/** Toggle switch (email on/off per event). */
function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on ? 'bg-violet-500' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/**
 * Email + per-event notification preferences, shown in the bell dropdown. In-app is
 * always on; this governs which events ALSO email you. Email needs a verified address,
 * and the whole email column is disabled when the server has no mailer configured.
 */
export function NotificationSettings() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ['me-email'], queryFn: getMeEmail });
  const { data: prefs } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: getNotificationPreferences,
  });
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');

  const refreshEmail = () => {
    qc.invalidateQueries({ queryKey: ['me-email'] });
    qc.invalidateQueries({ queryKey: ['notification-prefs'] });
  };
  const save = useMutation({ mutationFn: (e: string) => setEmail(e), onSuccess: refreshEmail });
  const verify = useMutation({
    mutationFn: (c: string) => verifyEmail(c),
    onSuccess: refreshEmail,
  });
  const remove = useMutation({ mutationFn: removeEmail, onSuccess: refreshEmail });
  const setPref = useMutation({
    mutationFn: (v: { type: string; email: boolean }) => setNotificationPreference(v.type, v.email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });

  const delivery = me?.emailDelivery ?? false;
  const verified = me?.emailVerified ?? false;
  const pendingVerify = !!me?.email && !verified;

  return (
    <div className="space-y-3 p-2">
      <div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Mail size={13} /> Email notifications
        </div>
        {!delivery && (
          <p className="mt-1 text-[11px] text-slate-500">
            Email delivery isn&apos;t configured on this deployment yet. In-app notifications still
            work; you can add an email to receive mail once it is enabled.
          </p>
        )}
        {verified ? (
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <Check size={13} /> {me?.email}
            </span>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 size={11} /> Remove
            </button>
          </div>
        ) : pendingVerify ? (
          <div className="mt-1.5 space-y-1.5">
            <p className="text-[11px] text-slate-400">
              We sent a code to <span className="text-slate-200">{me?.email}</span>. Enter it to
              confirm.
            </p>
            <div className="flex gap-1.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="6-digit code"
                className="w-28 rounded-lg bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/40"
              />
              <button
                onClick={() => verify.mutate(code)}
                disabled={verify.isPending || code.length < 4}
                className="rounded-lg border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
              >
                {verify.isPending ? 'Verifying…' : 'Verify'}
              </button>
              <button
                onClick={() => me?.email && save.mutate(me.email)}
                disabled={save.isPending}
                className="rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300"
              >
                Resend
              </button>
            </div>
            {verify.error && (
              <p className="text-[11px] text-amber-300">{(verify.error as Error).message}</p>
            )}
          </div>
        ) : (
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="flex-1 rounded-lg bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/40"
            />
            <button
              onClick={() => save.mutate(emailInput)}
              disabled={save.isPending || !emailInput.includes('@')}
              className="rounded-lg border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
            </button>
          </div>
        )}
      </div>

      {(prefs?.types.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-medium text-slate-500">Email me about</div>
          <div className="mt-1 space-y-1">
            {prefs?.types.map((t) => (
              <div key={t.type} className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-slate-300">{t.label}</span>
                <Toggle
                  on={t.email}
                  disabled={!verified || setPref.isPending}
                  onChange={(v) => setPref.mutate({ type: t.type, email: v })}
                />
              </div>
            ))}
          </div>
          {!verified && (
            <p className="mt-1 text-[10px] text-slate-600">Verify an email to turn these on.</p>
          )}
        </div>
      )}
    </div>
  );
}
