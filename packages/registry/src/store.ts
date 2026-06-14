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
 */
export function loadAgents(): AgentRecord[] {
  ensureDataDir();
  if (!fs.existsSync(REGISTRY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/** Overwrite `data/registry.json` with the given list of agents. */
export function saveAgents(agents: AgentRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2));
}

/** Find a single agent by its `agent_id`, or `undefined` if not registered. */
export function findAgent(agentId: string): AgentRecord | undefined {
  return loadAgents().find((a) => a.agent_id === agentId);
}

/**
 * Insert a new agent or replace an existing one with the same `agent_id`.
 * Returns the agent that was stored.
 */
export function upsertAgent(agent: AgentRecord): AgentRecord {
  const agents = loadAgents();
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
  const agents = loadAgents();
  const filtered = agents.filter((a) => a.agent_id !== agentId);
  if (filtered.length === agents.length) return false;
  saveAgents(filtered);
  return true;
}
