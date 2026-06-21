/**
 * JSON-file-backed persistence for the agent registry.
 *
 * All agents are stored as a single array in `data/registry.json`. Each
 * exported function reads or rewrites the whole file — there is no write
 * locking, so concurrent writers can race (see SECURITY.md "Known limitations").
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentRecord } from '@clevercon/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load all registered agents from `data/registry.json`.
 * Returns an empty array if the file doesn't exist or contains invalid JSON.
 * * Process state conversions automatically to evaluate agent freshness.
 */
export function loadAgents(includeInactive: boolean = false): AgentRecord[] {
  ensureDataDir();
  if (!fs.existsSync(REGISTRY_FILE)) return [];
  
  let agents: AgentRecord[] = [];
  try {
    agents = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch {
    return [];
  }

  const nowMs = Date.now();
  const ttlSeconds = Number(process.env.AGENT_TTL_SECONDS) || 120;
  const ttlThresholdMs = ttlSeconds * 1000;
  let mutated = false;

  // Process live lifecycle updates based on absolute timestamp drift
  const updatedAgents = agents.map((agent) => {
    const lastSeenMs = new Date(agent.last_seen).getTime();
    const isStale = nowMs - lastSeenMs > ttlThresholdMs;

    if (isStale && agent.status === 'active') {
      mutated = true;
      return { ...agent, status: 'inactive' as const };
    }
    return agent;
  });

  // Automatically sync back to JSON storage file if any statuses collapsed to inactive
  if (mutated) {
    saveAgents(updatedAgents);
  }

  if (includeInactive) {
    return updatedAgents;
  }
  return updatedAgents.filter((a) => a.status === 'active');
}

/** Overwrite `data/registry.json` with the given list of agents. */
export function saveAgents(agents: AgentRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2));
}

/** Find a single agent by its `agent_id`, or `undefined` if not registered. */
export function findAgent(agentId: string): AgentRecord | undefined {
  // Pass true to verify matching references across inactive items as well
  return loadAgents(true).find((a) => a.agent_id === agentId);
}

/**
 * Insert a new agent or replace an existing one with the same `agent_id`.
 * Returns the agent that was stored.
 */
export function upsertAgent(agent: AgentRecord): AgentRecord {
  const agents = loadAgents(true);
  const idx = agents.findIndex((a) => a.agent_id === agent.agent_id);
  if (idx >= 0) {
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
  saveAgents(agents);
  return agent;
}

/** Remove an agent by `agent_id`. Returns `true` if an agent was removed. */
export function removeAgent(agentId: string): boolean {
  const agents = loadAgents(true);
  const filtered = agents.filter((a) => a.agent_id !== agentId);
  if (filtered.length === agents.length) return false;
  saveAgents(filtered);
  return true;
}