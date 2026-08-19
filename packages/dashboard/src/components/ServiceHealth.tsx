import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fetchOrchestratorHealth, fetchRegistryHealth, type AgentRecord } from '../lib/api';

// ── Config ──────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 4_000;
// A single failed check doesn't flip a service to "down" — only two
// consecutive failures do. This absorbs one-off network blips without
// painting the whole bar red.
const FAILURE_THRESHOLD = 2;

type Health = 'checking' | 'up' | 'down';

interface ServiceState {
  id: string;
  name: string;
  health: Health;
  consecutiveFailures: number;
}

/**
 * Combine multiple AbortSignals into one, so a single fetch can be
 * cancelled by either a timeout or a per-poll unmount signal. Removes its
 * listeners from the source signals once the combined signal fires, so a
 * short-lived signal (e.g. AbortSignal.timeout) doesn't hold a dangling
 * listener after the poll that created it has finished.
 * (Avoids relying on AbortSignal.any, which isn't available in every
 * runtime this dashboard may be built for.)
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const alreadyAborted = signals.find((s) => s.aborted);

  if (alreadyAborted) {
    controller.abort(alreadyAborted.reason);
    return controller.signal;
  }

  const listeners = signals.map((signal) => {
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    return listener;
  });

  controller.signal.addEventListener(
    'abort',
    () => {
      signals.forEach((signal, i) => signal.removeEventListener('abort', listeners[i]));
    },
    { once: true },
  );

  return controller.signal;
}

const DOT_CLASSES: Record<Health, string> = {
  up: 'bg-emerald-400',
  down: 'bg-red-500',
  checking: 'bg-gray-500 animate-pulse',
};

const TEXT_CLASSES: Record<Health, string> = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  checking: 'text-gray-500',
};

function aggregate(services: ServiceState[]): Health {
  if (services.some((s) => s.health === 'down')) return 'down';
  if (services.some((s) => s.health === 'checking')) return 'checking';
  return 'up';
}

function applyResult(prev: ServiceState, ok: boolean): ServiceState {
  if (ok) {
    return { ...prev, health: 'up', consecutiveFailures: 0 };
  }
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const health: Health = consecutiveFailures >= FAILURE_THRESHOLD ? 'down' : prev.health;
  return { ...prev, health, consecutiveFailures };
}

function agentId(agent: AgentRecord, fallbackIndex: number): string {
  return agent.agent_id ?? agent.name ?? `agent-${fallbackIndex}`;
}

/**
 * ServiceHealth
 *
 * Compact, collapsible status bar showing whether the orchestrator, the
 * registry, and the registered agents are reachable. Polls on an interval;
 * every check is timeout-bounded and flapping is debounced.
 *
 * Agent health is derived from the registry's agent list (`status` field)
 * rather than fanning out a direct `/health` request per agent. This is
 * the cheaper option — one request covers every agent — at the cost of
 * being only as fresh as the registry's last known status, rather than a
 * live per-agent check.
 */
export default function ServiceHealth() {
  const [orchestrator, setOrchestrator] = useState<ServiceState>({
    id: 'orchestrator',
    name: 'Orchestrator',
    health: 'checking',
    consecutiveFailures: 0,
  });
  const [registry, setRegistry] = useState<ServiceState>({
    id: 'registry',
    name: 'Registry',
    health: 'checking',
    consecutiveFailures: 0,
  });
  const [agents, setAgents] = useState<ServiceState[]>([]);
  const [expanded, setExpanded] = useState(false);

  const mountedRef = useRef(true);
  // Recreated at the start of every poll, so each run's in-flight requests
  // can be cancelled independently on unmount — not one controller shared
  // (and never rotated) across the whole component lifetime.
  const pollControllerRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    const controller = new AbortController();
    pollControllerRef.current = controller;

    const signal = combineSignals([AbortSignal.timeout(REQUEST_TIMEOUT_MS), controller.signal]);

    const [orchestratorOk, registryResult] = await Promise.all([
      fetchOrchestratorHealth(signal).catch(() => false),
      fetchRegistryHealth(signal).catch(() => ({ ok: false, agents: [] as AgentRecord[] })),
    ]);

    if (!mountedRef.current) return;

    setOrchestrator((prev) => applyResult(prev, orchestratorOk));
    setRegistry((prev) => applyResult(prev, registryResult.ok));

    if (registryResult.ok) {
      setAgents((prev) => {
        const prevById = new Map(prev.map((a) => [a.id, a]));
        return registryResult.agents.map((a, i) => {
          const id = agentId(a, i);
          const prevState: ServiceState = prevById.get(id) ?? {
            id,
            name: a.name ?? id,
            health: 'checking',
            consecutiveFailures: 0,
          };
          const ok = a.status === 'active';
          return { ...applyResult(prevState, ok), name: a.name ?? id, id };
        });
      });
    }
    // When the registry itself is unreachable, leave the last-known agent
    // list in place rather than clearing it — a registry blip shouldn't
    // make every agent row disappear.
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      pollControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allServices = [orchestrator, registry, ...agents];
  const overall = aggregate(allServices);

  return (
    <div className="hidden sm:flex items-center">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800/60 text-xs hover:bg-gray-900 transition-colors"
        title="Service health"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${DOT_CLASSES[overall]}`} />
        <span className={TEXT_CLASSES[overall]}>Services</span>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>

      {expanded && (
        <div className="absolute top-12 mt-1 z-30 bg-gray-950/98 border border-gray-800 rounded-lg shadow-xl p-2 min-w-[180px] text-xs">
          {allServices.map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[s.health]}`} />
              <span className="text-gray-300 truncate">{s.name}</span>
              <span className={`ml-auto ${TEXT_CLASSES[s.health]}`}>{s.health}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}