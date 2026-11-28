import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  notificationHref,
  type Notification,
} from '../lib/notifications';
import { NotificationSettings } from './NotificationSettings';
import { useSession } from '../store/session';

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return `${h}h`;
  const m = Math.floor(diff / 60000);
  return m >= 1 ? `${m}m` : 'now';
}

function Row({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const href = notificationHref(n);
  const inner = (
    <div
      className={`flex gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05] ${
        n.read ? '' : 'bg-violet-500/[0.06]'
      }`}
    >
      {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />}
      <div className={n.read ? 'pl-[16px]' : ''}>
        <div className="text-[13px] font-medium text-slate-200">{n.title}</div>
        {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.body}</div>}
        <div className="mt-0.5 text-[10px] text-slate-600">{timeAgo(n.createdAt)} ago</div>
      </div>
    </div>
  );
  return href ? (
    <Link to={href} onClick={() => onOpen(n)}>
      {inner}
    </Link>
  ) : (
    <button onClick={() => onOpen(n)} className="block w-full">
      {inner}
    </button>
  );
}

/** The notification bell: unread badge + a dropdown feed. Hidden when signed out. */
export function NotificationBell() {
  const session = useSession((s) => s.session);
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const qc = useQueryClient();
  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: getUnreadCount,
    refetchInterval: 30000,
    enabled: !!session,
  });
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(15),
    enabled: !!session && open,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-unread'] });
  };
  const readOne = useMutation({ mutationFn: (id: string) => markRead([id]), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: refresh });

  if (!session) return null;

  const onOpen = (n: Notification) => {
    if (!n.read) readOne.mutate(n.id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-line-strong bg-white/[0.03] text-slate-300 transition-colors hover:bg-white/[0.07]"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-11 z-50 w-80 max-w-[90vw] rounded-2xl border border-line bg-[#0c0e16] p-2 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-semibold text-slate-200">
                {showSettings ? 'Notification settings' : 'Notifications'}
              </span>
              <div className="flex items-center gap-2">
                {!showSettings && unread > 0 && (
                  <button
                    onClick={() => readAll.mutate()}
                    disabled={readAll.isPending}
                    className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200 disabled:opacity-50"
                  >
                    <CheckCheck size={12} /> Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowSettings((s) => !s)}
                  aria-label={showSettings ? 'Back to notifications' : 'Notification settings'}
                  className={`rounded-md p-1 transition-colors hover:bg-white/[0.06] ${
                    showSettings ? 'text-violet-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Settings size={13} />
                </button>
              </div>
            </div>
            {showSettings ? (
              <div className="max-h-96 overflow-y-auto">
                <NotificationSettings />
              </div>
            ) : (
              <div className="max-h-96 space-y-0.5 overflow-y-auto">
                {(data?.items ?? []).length === 0 ? (
                  <p className="px-2.5 py-6 text-center text-xs text-slate-500">
                    Nothing yet. Updates on your hires, payouts, disputes, and reviews show here.
                  </p>
                ) : (
                  data?.items.map((n) => <Row key={n.id} n={n} onOpen={onOpen} />)
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
