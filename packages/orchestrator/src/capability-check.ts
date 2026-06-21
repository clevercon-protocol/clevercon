import Anthropic from '@anthropic-ai/sdk';
import type { AgentRecord } from '@clevercon/common';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface FeasibilityResult {
  feasible: boolean;
  needed: string[];
  available: string[];
  missing: string[];
}

/**
 * Determine whether the registered agents can collectively cover a task.
 *
 * When `LLM_PROVIDER=mock`, skips the Anthropic API and reports the task as
 * always feasible with no missing capabilities. Otherwise asks the configured
 * Anthropic model which capability tags the task needs and fuzzy-matches them
 * against the capabilities offered by `availableAgents`.
 */
export async function checkFeasibility(
  task: string,
  availableAgents: AgentRecord[],
): Promise<FeasibilityResult> {
  // Mock provider: skip the Anthropic API and assume the task is always feasible.
  if (process.env.LLM_PROVIDER === 'mock') {
    return { feasible: true, needed: [], available: [], missing: [] };
  }

  // All capabilities across registered agents
  const allCapabilities = new Set(availableAgents.flatMap((a) => a.capabilities));

  // Ask Claude what capabilities this task needs, anchored to known tags
  const response = await anthropic.messages.create({
    model:
      process.env.LLM_FEASIBILITY_MODEL ?? process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `What capabilities does this task require? Return ONLY a JSON array of short capability tags (lowercase, hyphenated).

Known capability tags available: ${[...allCapabilities].join(', ')}

Task: "${task}"

Instructions:
- Prefer tags from the known list when they fit
- Always include at least one tag — never return an empty array
- If the task needs something not in the known list, add the appropriate new tag
Return only the JSON array, no explanation:`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';

  let needed: string[] = [];
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    needed = JSON.parse(cleaned);
  } catch {
    needed = [];
  }

  // All capabilities across all registered agents (already computed above)

  // Fuzzy match: needed capability covered if any agent capability overlaps
  const available = needed.filter((c) =>
    [...allCapabilities].some(
      (ac) =>
        ac.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(ac.toLowerCase()),
    ),
  );
  const missing = needed.filter((c) => !available.includes(c));

  const feasible = needed.length === 0 || available.length / needed.length >= 0.7;

  return { feasible, needed, available, missing };
}
