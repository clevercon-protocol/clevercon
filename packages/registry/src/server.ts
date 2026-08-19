import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { loadAgents, findAgent, upsertAgent, removeAgent } from './store.js';
import { updateReputation } from './reputation.js';
import { matchCapabilities } from './search.js';
import { validateRegistration } from './validate.js';
import { logger } from '@clevercon/common';
import type { AgentManifest, AgentFeedback, AgentRecord } from '@clevercon/common';

const app = express();
const PORT = parseInt(process.env.REGISTRY_PORT || process.env.PORT || '4000', 10);

app.use(cors());
app.use(express.json());

// POST /register — register or update an agent
app.post('/register', (req, res) => {
  const body = req.body as Partial<AgentManifest> & { registered_by?: string };

  // Validate required top-level fields are present
  const required = [
    'agent_id',
    'name',
    'capabilities',
    'pricing',
    'endpoint',
    'stellar_address',
    'health_check',
  ];
  const missing = required.filter((f) => !(f in body));
  if (missing.length > 0) {
    return res
      .status(400)
      .json({ error: `Missing fields: ${missing.join(', ')}`, fields: missing });
  }

  // Validate field values
  const invalidFields = validateRegistration(body as Record<string, unknown>);
  if (invalidFields.length > 0) {
    return res.status(400).json({
      error: `Invalid field values: ${invalidFields.join(', ')}`,
      fields: invalidFields,
    });
  }

  const now = new Date().toISOString();
  const existing = findAgent(body.agent_id!);

  const record: AgentRecord = {
    ...(body as AgentManifest),
    // Preserve original registered_by; allow update only if not already set
    registered_by: existing?.registered_by ?? body.registered_by,
    registered_at: existing?.registered_at || now,
    last_seen: now,
    status: 'active',
    reputation: existing?.reputation || {
      score: 50,
      total_jobs: 0,
      successful_jobs: 0,
      failed_jobs: 0,
      avg_quality: 3.0,
      avg_latency_ms: 0,
      last_updated: now,
    },
  };

  upsertAgent(record);
  logger.info(`Agent registered: ${record.name} (${record.agent_id})`);
  return res.json(record);
});

// GET /agents — discover agents with optional filters and pagination
app.get('/agents', (req, res) => {
  let agents = loadAgents();

  const { capabilities, min_reputation, payment_model, status, limit, offset } = req.query;

  // Apply filters
  if (capabilities) {
    const caps = (capabilities as string).split(',').map((c) => c.trim());
    agents = matchCapabilities(agents, caps);
  }

  if (min_reputation) {
    const minRep = parseFloat(min_reputation as string);
    agents = agents.filter((a) => a.reputation.score >= minRep);
  }

  if (payment_model) {
    agents = agents.filter((a) => a.pricing.model === payment_model);
  }

  if (status) {
    agents = agents.filter((a) => a.status === status);
  }

  // Order by reputation (highest first) for stable pagination
  agents.sort((a, b) => b.reputation.score - a.reputation.score);

  const total = agents.length;

  // Check if pagination is requested
  const hasPagination = limit !== undefined || offset !== undefined;

  if (hasPagination) {
    // Parse and clamp limit (default: 20, max: 100, min: 1)
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const parsedLimit = limit ? parseInt(limit as string, 10) : DEFAULT_LIMIT;
    // Use default only for NaN or absent, clamp numeric zero to 1
    const clampedLimit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : parsedLimit),
    );

    // Parse and clamp offset (default: 0, min: 0)
    // Guard against non-numeric values (e.g. "abc") that would produce NaN
    const parsedOffset = offset ? parseInt(offset as string, 10) || 0 : 0;
    const clampedOffset = Math.max(0, parsedOffset);

    // Apply pagination
    const paginatedAgents = agents.slice(clampedOffset, clampedOffset + clampedLimit);

    return res.json({
      agents: paginatedAgents,
      total,
      limit: clampedLimit,
      offset: clampedOffset,
    });
  }

  // Backward compatibility: return bare array when no pagination params
  return res.json(agents);
});

// GET /agents/:id — single agent lookup
app.get('/agents/:id', (req, res) => {
  const agent = findAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  return res.json(agent);
});

// POST /feedback — submit job feedback and update reputation
app.post('/feedback', (req, res) => {
  const body = req.body as Partial<AgentFeedback>;
  const required = ['agent_id', 'job_id', 'success', 'quality_rating', 'latency_ms', 'timestamp'];
  const missing = required.filter((f) => !(f in body));
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  const agent = findAgent(body.agent_id!);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const updated = updateReputation(agent, body as AgentFeedback);
  updated.last_seen = new Date().toISOString();
  upsertAgent(updated);

  logger.info(
    `Feedback recorded for ${agent.name}: success=${body.success}, quality=${body.quality_rating}`,
  );
  return res.json(updated);
});

/** Returns true if requester is authorised to modify this agent.
 *  Authorised = agent's own stellar_address OR the user who registered it (registered_by). */
function isAuthorised(agent: AgentRecord, requester_address: string): boolean {
  return (
    requester_address === agent.stellar_address ||
    (!!agent.registered_by && requester_address === agent.registered_by)
  );
}

// PATCH /agents/:id — update mutable fields (name, description)
// Authorised: agent's stellar_address OR the registered_by user address.
app.patch('/agents/:id', (req, res) => {
  const agent = findAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { name, description, requester_address } = req.body as {
    name?: string;
    description?: string;
    requester_address?: string;
  };
  if (!requester_address) {
    return res.status(400).json({ error: 'requester_address is required' });
  }
  if (!isAuthorised(agent, requester_address)) {
    return res.status(403).json({
      error: 'Not authorised: requester_address does not match agent owner or registrant',
    });
  }
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    agent.name = name.trim();
  }
  if (description !== undefined) agent.description = description;
  agent.last_seen = new Date().toISOString();
  upsertAgent(agent);
  return res.json(agent);
});

// DELETE /agents/:id — deregister agent
// Authorised: agent's stellar_address OR the registered_by user address.
app.delete('/agents/:id', (req, res) => {
  const agent = findAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const requester_address =
    (req.body as { requester_address?: string })?.requester_address ??
    (req.query.requester_address as string | undefined);
  if (!requester_address) {
    return res.status(400).json({ error: 'requester_address is required' });
  }
  if (!isAuthorised(agent, requester_address)) {
    return res.status(403).json({
      error: 'Not authorised: requester_address does not match agent owner or registrant',
    });
  }
  const removed = removeAgent(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Agent not found' });
  logger.info(`Agent deregistered: ${req.params.id}`);
  return res.json({ success: true });
});

// GET /health
app.get('/health', (_req, res) => {
  const agents = loadAgents();
  return res.json({
    status: 'ok',
    agent_count: agents.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /.well-known/x402 — machine-readable marketplace metadata
app.get('/.well-known/x402', (_req, res) => {
  const agents = loadAgents();
  const services = agents.map((a) => ({
    agent_id: a.agent_id,
    name: a.name,
    description: a.description,
    capabilities: a.capabilities,
    endpoint: a.endpoint,
    pricing: a.pricing,
    stellar_address: a.stellar_address,
    health_check: a.health_check,
    reputation_score: a.reputation.score,
  }));
  return res.json({
    version: '1.0',
    network: process.env.STELLAR_NETWORK || 'stellar:testnet',
    registry: process.env.REGISTRY_URL || `http://localhost:${PORT}`,
    services,
    updated_at: new Date().toISOString(),
  });
});

// Export app for integration tests (supertest imports this without calling listen)
export { app };

// Only bind the port when this module is the entry-point, not during tests
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Service Registry running on http://localhost:${PORT}`);
  });
}
