import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToast, type Toast } from '../contexts/ToastContext';

const VARIANTS = {
  success: {
    icon: CheckCircle,
    bg: 'bg-emerald-950 border-emerald-800',
    icon_class: 'text-emerald-400',
    text: 'text-emerald-200',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-red-950 border-red-800',
    icon_class: 'text-red-400',
    text: 'text-red-200',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-950 border-amber-800',
    icon_class: 'text-amber-400',
    text: 'text-amber-200',
  },
  info: {
    icon: Info,
    bg: 'bg-gray-900 border-gray-700',
    icon_class: 'text-purple-400',
    text: 'text-gray-200',
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const cfg = VARIANTS[toast.variant];
  const Icon = cfg.icon;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-sm ${cfg.bg} animate-in slide-in-from-right-4 duration-200`}>
      <Icon size={15} className={`shrink-0 mt-px ${cfg.icon_class}`} />
      <p className={`text-xs flex-1 leading-relaxed ${cfg.text}`}>{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
