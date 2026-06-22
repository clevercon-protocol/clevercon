import { describe, it, expect } from 'vitest';
import { validateRegistration } from './validate.js';

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
// pricing object missing entirely
// ---------------------------------------------------------------------------

describe('validateRegistration — missing pricing object', () => {
  it('reports both pricing sub-fields when pricing is null', () => {
    const fields = validateRegistration(withOverride({ pricing: null }));
    expect(fields).toContain('pricing.model');
    expect(fields).toContain('pricing.price_per_call');
  });

  it('reports both pricing sub-fields when pricing is a plain string', () => {
    const fields = validateRegistration(withOverride({ pricing: 'x402:0.05' }));
    expect(fields).toContain('pricing.model');
    expect(fields).toContain('pricing.price_per_call');
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
  });
});
