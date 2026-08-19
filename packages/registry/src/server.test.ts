import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { validateRegistration } from './validate.js';
import { loadAgents, upsertAgent, removeAgent } from './store.js';
import { app } from './server.js';
import type { AgentRecord } from '@clevercon/common';

const validBody = {
  agent_id: 'agent-web-intel',
  name: 'Web Intel Agent',
  description: 'Scrapes and summarises web content',
  capabilities: ['web-search', 'news'],
  pricing: {
    model: 'x402',
    price_per_call: 0.05,
    currency: 'USDC',
  },
  endpoint: 'https://agents.example.com/web-intel',
  stellar_address: 'GABC123',
  health_check: 'https://agents.example.com/web-intel/health',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withOverride(overrides: Record<string, unknown>) {
  return { ...validBody, ...overrides };
}

// ---------------------------------------------------------------------------
// Valid registration
// ---------------------------------------------------------------------------

describe('validateRegistration — valid body', () => {
  it('returns no invalid fields for a fully valid body', () => {
    expect(validateRegistration(validBody)).toEqual([]);
  });

  it('accepts description being absent (it is optional at value-validation level)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { description: _omit, ...withoutDescription } = validBody;
    expect(validateRegistration(withoutDescription as Record<string, unknown>)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// agent_id
// ---------------------------------------------------------------------------

describe('validateRegistration — agent_id', () => {
  it('rejects an empty string', () => {
    expect(validateRegistration(withOverride({ agent_id: '' }))).toContain('agent_id');
  });

  it('rejects a whitespace-only string', () => {
    expect(validateRegistration(withOverride({ agent_id: '   ' }))).toContain('agent_id');
  });

  it('rejects an agent_id that contains internal whitespace', () => {
    expect(validateRegistration(withOverride({ agent_id: 'my agent' }))).toContain('agent_id');
  });

  it('rejects a non-string value', () => {
    expect(validateRegistration(withOverride({ agent_id: 42 }))).toContain('agent_id');
  });
});

// ---------------------------------------------------------------------------
// name
// ---------------------------------------------------------------------------

describe('validateRegistration — name', () => {
  it('rejects an empty name', () => {
    expect(validateRegistration(withOverride({ name: '' }))).toContain('name');
  });

  it('rejects a whitespace-only name', () => {
    expect(validateRegistration(withOverride({ name: '   ' }))).toContain('name');
  });
});

// ---------------------------------------------------------------------------
// description (optional but must be non-empty when present)
// ---------------------------------------------------------------------------

describe('validateRegistration — description', () => {
  it('rejects an empty description string when the key is present', () => {
    expect(validateRegistration(withOverride({ description: '' }))).toContain('description');
  });

  it('rejects a whitespace-only description', () => {
    expect(validateRegistration(withOverride({ description: '   ' }))).toContain('description');
  });

  it('accepts a valid description string', () => {
    expect(validateRegistration(withOverride({ description: 'A useful agent' }))).not.toContain(
      'description',
    );
  });
});

// ---------------------------------------------------------------------------
// endpoint — URL validation
// ---------------------------------------------------------------------------

describe('validateRegistration — endpoint URL', () => {
  it('rejects a plain string that is not a URL', () => {
    expect(validateRegistration(withOverride({ endpoint: 'not-a-url' }))).toContain('endpoint');
  });

  it('rejects an empty string', () => {
    expect(validateRegistration(withOverride({ endpoint: '' }))).toContain('endpoint');
  });

  it('rejects a relative path', () => {
    expect(validateRegistration(withOverride({ endpoint: '/agents/web-intel' }))).toContain(
      'endpoint',
    );
  });

  it('accepts an http URL', () => {
    expect(
      validateRegistration(withOverride({ endpoint: 'http://localhost:5000/agent' })),
    ).not.toContain('endpoint');
  });

  it('accepts an https URL', () => {
    expect(
      validateRegistration(withOverride({ endpoint: 'https://agents.example.com' })),
    ).not.toContain('endpoint');
  });
});

// ---------------------------------------------------------------------------
// health_check — URL validation
// ---------------------------------------------------------------------------

describe('validateRegistration — health_check URL', () => {
  it('rejects a relative path like /health', () => {
    expect(validateRegistration(withOverride({ health_check: '/health' }))).toContain(
      'health_check',
    );
  });

  it('rejects a non-URL string', () => {
    expect(validateRegistration(withOverride({ health_check: 'not a url' }))).toContain(
      'health_check',
    );
  });

  it('accepts a valid https health-check URL', () => {
    expect(
      validateRegistration(withOverride({ health_check: 'https://agents.example.com/health' })),
    ).not.toContain('health_check');
  });
});

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

describe('validateRegistration — capabilities', () => {
  it('rejects an empty array', () => {
    expect(validateRegistration(withOverride({ capabilities: [] }))).toContain('capabilities');
  });

  it('rejects a non-array value', () => {
    expect(validateRegistration(withOverride({ capabilities: 'web-search' }))).toContain(
      'capabilities',
    );
  });

  it('rejects an array that contains an empty string', () => {
    expect(validateRegistration(withOverride({ capabilities: ['web-search', ''] }))).toContain(
      'capabilities',
    );
  });

  it('rejects an array that contains a whitespace-only string', () => {
    expect(validateRegistration(withOverride({ capabilities: ['   '] }))).toContain('capabilities');
  });

  it('accepts an array of non-empty strings', () => {
    expect(
      validateRegistration(withOverride({ capabilities: ['web-search', 'news'] })),
    ).not.toContain('capabilities');
  });
});

// ---------------------------------------------------------------------------
// pricing.model
// ---------------------------------------------------------------------------

describe('validateRegistration — pricing.model', () => {
  it('rejects an unrecognised model string', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, model: 'free' } });
    expect(validateRegistration(body)).toContain('pricing.model');
  });

  it('rejects a numeric model value', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, model: 1 } });
    expect(validateRegistration(body)).toContain('pricing.model');
  });

  it('accepts "x402"', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, model: 'x402' } });
    expect(validateRegistration(body)).not.toContain('pricing.model');
  });

  it('accepts "mpp"', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, model: 'mpp' } });
    expect(validateRegistration(body)).not.toContain('pricing.model');
  });
});

// ---------------------------------------------------------------------------
// pricing.price_per_call
// ---------------------------------------------------------------------------

describe('validateRegistration — pricing.price_per_call', () => {
  it('rejects zero', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: 0 } });
    expect(validateRegistration(body)).toContain('pricing.price_per_call');
  });

  it('rejects a negative number', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: -1 } });
    expect(validateRegistration(body)).toContain('pricing.price_per_call');
  });

  it('rejects Infinity', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: Infinity } });
    expect(validateRegistration(body)).toContain('pricing.price_per_call');
  });

  it('rejects NaN', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: NaN } });
    expect(validateRegistration(body)).toContain('pricing.price_per_call');
  });

  it('rejects a string price', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: '0.05' } });
    expect(validateRegistration(body)).toContain('pricing.price_per_call');
  });

  it('accepts a positive finite number', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, price_per_call: 0.001 } });
    expect(validateRegistration(body)).not.toContain('pricing.price_per_call');
  });
});

// ---------------------------------------------------------------------------
// pricing.currency
// ---------------------------------------------------------------------------

describe('validateRegistration — pricing.currency', () => {
  it('rejects a missing currency', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { currency: _omit, ...pricingWithoutCurrency } = validBody.pricing;
    const body = withOverride({ pricing: pricingWithoutCurrency });
    expect(validateRegistration(body)).toContain('pricing.currency');
  });

  it('rejects a currency other than USDC', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, currency: 'XLM' } });
    expect(validateRegistration(body)).toContain('pricing.currency');
  });

  it('accepts USDC', () => {
    const body = withOverride({ pricing: { ...validBody.pricing, currency: 'USDC' } });
    expect(validateRegistration(body)).not.toContain('pricing.currency');
  });
});

// ---------------------------------------------------------------------------
// pricing object missing entirely
// ---------------------------------------------------------------------------

describe('validateRegistration — missing pricing object', () => {
  it('reports all three pricing sub-fields when pricing is null', () => {
    const fields = validateRegistration(withOverride({ pricing: null }));
    expect(fields).toContain('pricing.model');
    expect(fields).toContain('pricing.price_per_call');
    expect(fields).toContain('pricing.currency');
  });

  it('reports all three pricing sub-fields when pricing is a plain string', () => {
    const fields = validateRegistration(withOverride({ pricing: 'x402:0.05' }));
    expect(fields).toContain('pricing.model');
    expect(fields).toContain('pricing.price_per_call');
    expect(fields).toContain('pricing.currency');
  });
});

// ---------------------------------------------------------------------------
// Multiple simultaneous errors
// ---------------------------------------------------------------------------

describe('validateRegistration — multiple errors', () => {
  it('collects all invalid fields in one pass', () => {
    const fields = validateRegistration({
      agent_id: 'my agent', // whitespace → invalid
      name: '',
      endpoint: 'not-a-url',
      health_check: '/health',
      capabilities: [],
      pricing: { model: 'unknown', price_per_call: -5 },
    });

    expect(fields).toContain('agent_id');
    expect(fields).toContain('name');
    expect(fields).toContain('endpoint');
    expect(fields).toContain('health_check');
    expect(fields).toContain('capabilities');
    expect(fields).toContain('pricing.model');
    expect(fields).toContain('pricing.price_per_call');
    expect(fields).toContain('pricing.currency');
  });
});

// ---------------------------------------------------------------------------
// Pagination tests for GET /agents
// ---------------------------------------------------------------------------

describe('GET /agents pagination', () => {
  const now = new Date().toISOString();

  const mockAgents: AgentRecord[] = [
    {
      agent_id: 'agent-1',
      name: 'Agent 1',
      description: 'Test agent 1',
      capabilities: ['test'],
      pricing: { model: 'x402', price_per_call: 0.05, currency: 'USDC' },
      endpoint: 'https://example.com/agent1',
      stellar_address: 'GABC1',
      health_check: 'https://example.com/agent1/health',
      registered_by: 'user1',
      registered_at: now,
      last_seen: now,
      status: 'active',
      reputation: {
        score: 90,
        total_jobs: 10,
        successful_jobs: 9,
        failed_jobs: 1,
        avg_quality: 4.5,
        avg_latency_ms: 100,
        last_updated: now,
      },
    },
    {
      agent_id: 'agent-2',
      name: 'Agent 2',
      description: 'Test agent 2',
      capabilities: ['test'],
      pricing: { model: 'x402', price_per_call: 0.05, currency: 'USDC' },
      endpoint: 'https://example.com/agent2',
      stellar_address: 'GABC2',
      health_check: 'https://example.com/agent2/health',
      registered_by: 'user1',
      registered_at: now,
      last_seen: now,
      status: 'active',
      reputation: {
        score: 70,
        total_jobs: 5,
        successful_jobs: 4,
        failed_jobs: 1,
        avg_quality: 4.0,
        avg_latency_ms: 150,
        last_updated: now,
      },
    },
    {
      agent_id: 'agent-3',
      name: 'Agent 3',
      description: 'Test agent 3',
      capabilities: ['test'],
      pricing: { model: 'x402', price_per_call: 0.05, currency: 'USDC' },
      endpoint: 'https://example.com/agent3',
      stellar_address: 'GABC3',
      health_check: 'https://example.com/agent3/health',
      registered_by: 'user1',
      registered_at: now,
      last_seen: now,
      status: 'active',
      reputation: {
        score: 50,
        total_jobs: 3,
        successful_jobs: 2,
        failed_jobs: 1,
        avg_quality: 3.5,
        avg_latency_ms: 200,
        last_updated: now,
      },
    },
  ];

  beforeEach(() => {
    // Clear existing agents
    const existing = loadAgents();
    existing.forEach((agent) => removeAgent(agent.agent_id));
    // Add mock agents
    mockAgents.forEach((agent) => upsertAgent(agent));
  });

  it('returns bare array when no pagination params (backward compatibility)', async () => {
    const res = await request(app).get('/agents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
  });

  it('applies default limit when only limit param key is provided', async () => {
    const res = await request(app).get('/agents?offset=0');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents.length).toBe(3); // all agents fit within default limit
  });

  it('honors custom limit and returns correct page size', async () => {
    const res = await request(app).get('/agents?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.agents.length).toBe(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBe(3);
  });

  it('honors offset and skips correct number of results', async () => {
    const res = await request(app).get('/agents?limit=2&offset=1');
    expect(res.status).toBe(200);
    expect(res.body.agents.length).toBe(2);
    expect(res.body.agents[0].agent_id).toBe('agent-2');
    expect(res.body.offset).toBe(1);
  });

  it('returns empty array when offset exceeds result set', async () => {
    const res = await request(app).get('/agents?limit=10&offset=100');
    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([]);
    expect(res.body.total).toBe(3);
  });

  it('clamps limit to maximum (100)', async () => {
    const res = await request(app).get('/agents?limit=200');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.agents.length).toBe(3); // all 3 fit within clamped limit
  });

  it('clamps limit to minimum (1) when limit is 0', async () => {
    // limit=0 is parsed as 0, which is clamped to the minimum value of 1
    const res = await request(app).get('/agents?limit=0');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1); // numeric zero is clamped to minimum of 1
    expect(Array.isArray(res.body.agents)).toBe(true);
  });

  it('clamps offset to minimum (0) when offset is negative', async () => {
    const res = await request(app).get('/agents?limit=2&offset=-5');
    expect(res.status).toBe(200);
    expect(res.body.offset).toBe(0);
    expect(res.body.agents.length).toBe(2);
  });

  it('treats non-numeric offset (e.g. "abc") as 0', async () => {
    const res = await request(app).get('/agents?limit=2&offset=abc');
    expect(res.status).toBe(200);
    expect(res.body.offset).toBe(0);
    expect(res.body.agents.length).toBe(2);
  });

  it('orders agents by reputation descending before pagination', async () => {
    const res = await request(app).get('/agents?limit=3');
    expect(res.status).toBe(200);
    const ids = res.body.agents.map((a: AgentRecord) => a.agent_id);
    expect(ids[0]).toBe('agent-1'); // score 90
    expect(ids[1]).toBe('agent-2'); // score 70
    expect(ids[2]).toBe('agent-3'); // score 50
  });

  it('returns total count in envelope response', async () => {
    const res = await request(app).get('/agents?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.agents.length).toBe(1);
  });
});
