const ALLOWED_PRICING_MODELS = ['x402', 'mpp'] as const;

function isValidUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function validateRegistration(body: Record<string, unknown>): string[] {
  const invalid: string[] = [];

  // agent_id: non-empty string, no whitespace
  if (
    typeof body.agent_id !== 'string' ||
    body.agent_id.trim() === '' ||
    /\s/.test(body.agent_id)
  ) {
    invalid.push('agent_id');
  }

  // name: non-empty string
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    invalid.push('name');
  }

  // description: optional — only validate when the key is present
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.trim() === '') {
      invalid.push('description');
    }
  }

  // endpoint: valid absolute URL
  if (!isValidUrl(body.endpoint)) {
    invalid.push('endpoint');
  }

  // health_check: valid absolute URL
  if (!isValidUrl(body.health_check)) {
    invalid.push('health_check');
  }

  // capabilities: non-empty array of non-empty strings
  if (
    !Array.isArray(body.capabilities) ||
    body.capabilities.length === 0 ||
    body.capabilities.some((c) => typeof c !== 'string' || c.trim() === '')
  ) {
    invalid.push('capabilities');
  }

  // pricing: must be a plain object
  if (
    body.pricing === null ||
    typeof body.pricing !== 'object' ||
    Array.isArray(body.pricing)
  ) {
    invalid.push('pricing.model', 'pricing.price_per_call');
  } else {
    const pricing = body.pricing as Record<string, unknown>;

    if (
      !ALLOWED_PRICING_MODELS.includes(
        pricing.model as (typeof ALLOWED_PRICING_MODELS)[number],
      )
    ) {
      invalid.push('pricing.model');
    }

    if (
      typeof pricing.price_per_call !== 'number' ||
      !Number.isFinite(pricing.price_per_call) ||
      pricing.price_per_call <= 0
    ) {
      invalid.push('pricing.price_per_call');
    }
  }

  return invalid;
}
