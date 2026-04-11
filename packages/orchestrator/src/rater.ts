import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function rateResponse(
  action: string,
  output: string,
): Promise<number> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Rate the quality of this agent response on a scale of 1-5.
1=unusable, 2=poor, 3=acceptable, 4=good, 5=excellent.

Task given to agent: "${action}"

Agent response:
${output.slice(0, 1000)}

Reply with ONLY a single digit 1-5:`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '3';
    const rating = parseInt(text.charAt(0), 10);
    return isNaN(rating) || rating < 1 || rating > 5 ? 3 : rating;
  } catch {
    return 3; // Default to neutral on failure
  }
}
