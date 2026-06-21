import Anthropic from '@anthropic-ai/sdk';

// Lazy init — Anthropic SDK throws at construction if apiKey is missing
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export async function analyzeWithClaude(data: string, instruction: string): Promise<string> {
  const response = await getClient().messages.create({
    model: process.env.LLM_ANALYSIS_MODEL ?? process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `${instruction}\n\nData to analyze:\n${data}\n\nProvide a structured analysis with: key trends, risks, and outlook. Be concise and data-driven.`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'Analysis unavailable';
}
