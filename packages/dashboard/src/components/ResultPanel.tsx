import { FileText, CheckCircle, AlertTriangle, XCircle, ExternalLink, Clock, DollarSign } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-200 mt-4 mb-1.5">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-white mt-5 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-200 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-gray-300">$1</em>')
    .replace(/`([^`]+)`/g, '<code class="font-mono text-xs bg-gray-800 text-purple-300 px-1.5 py-0.5 rounded">$1</code>')
    .replace(/^---$/gm, '<hr class="border-gray-800 my-3">')
    .replace(/^\| (.+)$/gm, (line) => {
      if (line.includes('|---')) return '';
      const cells = line.split('|').filter(Boolean).map(c => c.trim());
      return `<tr>${cells.map(c => `<td class="px-3 py-1.5 border-b border-gray-800 text-xs text-gray-400">${c}</td>`).join('')}</tr>`;
    })
    .replace(/^- (.+)$/gm, '<li class="text-xs text-gray-400 ml-4 list-disc leading-relaxed">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="text-xs text-gray-400 ml-4 list-decimal leading-relaxed">$1</li>')
    .replace(/\n\n/g, '\n')
    .split('\n')
    .map(line => {
      if (!line.trim()) return '';
      if (line.startsWith('<')) return line;
      return `<p class="text-xs text-gray-400 leading-relaxed mb-1">${line}</p>`;
    })
    .join('\n');
}

export function ResultPanel({ events }: Props) {
  const taskResult = events.find(e => e.event === 'task_result')?.data;
  const taskError = events.find(e => e.event === 'task_error')?.data;
  const taskComplete = events.find(e => e.event === 'task_complete')?.data;

  if (!taskResult && !taskError && !taskComplete) return null;

  const status = taskResult?.status ?? (taskError ? 'failed' : 'running');

  const statusConfig = {
    complete: { icon: <CheckCircle size={13} className="text-emerald-400" />, label: 'Complete', color: 'text-emerald-400', border: 'border-emerald-900/40', bg: 'bg-emerald-950/20' },
    partial:  { icon: <AlertTriangle size={13} className="text-amber-400" />, label: 'Partial',  color: 'text-amber-400',   border: 'border-amber-900/40',   bg: 'bg-amber-950/20' },
    failed:   { icon: <XCircle size={13} className="text-red-400" />,         label: 'Failed',   color: 'text-red-400',     border: 'border-red-900/40',     bg: 'bg-red-950/20' },
  }[status as string] ?? { icon: <FileText size={13} className="text-gray-400" />, label: status, color: 'text-gray-400', border: 'border-gray-700', bg: '' };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-200">Result</h2>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${statusConfig.border} ${statusConfig.bg}`}>
            {statusConfig.icon}
            <span className={`text-xs font-medium capitalize ${statusConfig.color}`}>{statusConfig.label}</span>
          </div>
        </div>
        {taskResult && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <DollarSign size={10} />
              <span className="font-mono tabular-nums">{taskResult.total_cost?.toFixed(4)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={10} />
              <span className="tabular-nums">{(taskResult.total_time_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {taskError && (
        <div className="mx-4 mt-4 bg-red-950/40 border border-red-900/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-400 mb-1">Error</p>
          <p className="text-xs text-red-300/80">{taskError.error}</p>
        </div>
      )}

      {/* Output */}
      {taskResult?.final_output && (
        <div
          className="px-4 py-4 max-h-72 overflow-y-auto text-xs text-gray-400 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(taskResult.final_output) }}
        />
      )}

      {/* Steps */}
      {taskResult?.steps && taskResult.steps.length > 0 && (
        <div className="px-4 pb-4 border-t border-gray-800 mt-0 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Execution Steps</p>
          <div className="space-y-1.5">
            {taskResult.steps.map((step: any) => (
              <div key={step.step_id} className={`flex items-center gap-2.5 text-xs px-3 py-2 rounded-xl ${step.success ? 'bg-gray-800/50' : 'bg-red-950/30'}`}>
                {step.success
                  ? <CheckCircle size={11} className="text-emerald-400 shrink-0" />
                  : <XCircle size={11} className="text-red-400 shrink-0" />}
                <span className={`font-medium ${step.success ? 'text-gray-300' : 'text-red-400'}`}>{step.agent_name}</span>
                <span className="text-gray-700">·</span>
                <span className="text-gray-500 tabular-nums">{(step.latency_ms / 1000).toFixed(1)}s</span>
                {step.payment?.tx_hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${step.payment.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-gray-600 hover:text-blue-400 transition-colors font-mono"
                  >
                    <span>{step.payment.tx_hash.slice(0, 8)}…</span>
                    <ExternalLink size={9} />
                  </a>
                )}
                {!step.success && step.error && (
                  <span className="text-red-500 truncate ml-auto max-w-48 text-right">{step.error.slice(0, 60)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
