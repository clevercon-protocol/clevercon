import { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { useToasts, type Toast } from '../store/toasts';

/** Bottom-right toast stack. Mount once in the Shell. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 6000);
    return () => clearTimeout(id);
  }, [onDismiss]);
  const Icon =
    toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertTriangle : Info;
  const tint =
    toast.kind === 'success'
      ? 'text-emerald-300'
      : toast.kind === 'error'
        ? 'text-red-300'
        : 'text-violet-300';
  return (
    <div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line-strong bg-surface-2 p-3 shadow-lg">
      <Icon size={16} className={`mt-0.5 shrink-0 ${tint}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-200">{toast.title}</div>
        {toast.body && <div className="mt-0.5 text-xs text-slate-400">{toast.body}</div>}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
      >
        <X size={14} />
      </button>
    </div>
  );
}
