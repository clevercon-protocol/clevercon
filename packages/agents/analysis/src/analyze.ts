import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function analyzeWithClaude(data: string, instruction: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `${instruction}\n\nData to analyze:\n${data}\n\nProvide a structured analysis with: key trends, risks, and outlook. Be concise and data-driven.`,
    }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'Analysis unavailable';
}
