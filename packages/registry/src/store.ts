/**
 * JSON-file-backed persistence for the agent registry.
 *
 * All agents are stored as a single array in `data/registry.json`. Each
 * exported function reads or rewrites the whole file — writes are serialized
 * through an in-process queue and use atomic rename to prevent corruption.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentRecord } from '@clevercon/common';
import { writeJsonSafe, logger } from '@clevercon/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

/** In-memory cache — avoids reading stale data between queued writes. */
let cache: AgentRecord[] | null = null;

/** In-process write queue — serializes all disk writes. */
let writeQueue: Promise<void> = Promise.resolve();

/** Track consecutive write failures to surface persistent I/O issues. */
let consecutiveWriteFailures = 0;

/**
 * Load all registered agents from `data/registry.json`.
 * Returns an empty array if the file doesn't exist or contains invalid JSON.
 * Uses an in-memory cache so that concurrent readers see the latest state
 * even if a queued write hasn't flushed to disk yet.
 */
export function loadAgents(): AgentRecord[] {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(REGISTRY_FILE)) {
      cache = [];
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as AgentRecord[];
  } catch {
    cache = [];
  }
  return cache;
}

/** Overwrite `data/registry.json` with the given list of agents. */
export function saveAgents(agents: AgentRecord[]): void {
  cache = agents;
  writeQueue = writeQueue
    .then(() => {
      writeJsonSafe(REGISTRY_FILE, agents);
      consecutiveWriteFailures = 0;
    })
    .catch((err) => {
      consecutiveWriteFailures++;
      logger.error('Registry save failed', err instanceof Error ? err.message : String(err));
      if (consecutiveWriteFailures >= 3) {
        logger.warn(
          `Registry: ${consecutiveWriteFailures} consecutive write failures — in-memory cache may diverge from disk`,
        );
      }
    });
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
