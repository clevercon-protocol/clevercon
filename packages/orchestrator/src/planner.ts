import Anthropic from '@anthropic-ai/sdk';
import type { AgentRecord, ExecutionPlan } from '@clevercon/common';
import { scoreAgents } from './selector.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Stellar context injected into planner system prompt (llms.txt pattern)
const STELLAR_CONTEXT = `
You are orchestrating AI agents on the Stellar blockchain network.
Available data sources include: Stellar DEX orderbook, XLM/USDC trading pairs, account balances,
network stats, real-time crypto prices, blockchain/crypto/tech/AI news feeds, web page scraping.
All agent payments use USDC stablecoins on Stellar testnet.
`;

/**
 * Decompose a task into an {@link ExecutionPlan} using the available agents.
 *
 * When `LLM_PROVIDER=mock`, skips the Anthropic API and returns a deterministic
 * single-step stub plan built from the first registered agent — letting the
 * orchestrator run locally without an API key. Otherwise prompts the configured
 * Anthropic model (`LLM_PLANNER_MODEL` ?? `LLM_MODEL`, default `claude-sonnet-4-5`)
 * and parses its JSON response.
 */
export async function createPlan(
  task: string,
  availableAgents: AgentRecord[],
  budget: number,
): Promise<ExecutionPlan> {
  // Mock provider: skip the Anthropic API and return a deterministic single-step
  // plan so the orchestrator can run locally without an API key.
  if (process.env.LLM_PROVIDER === 'mock') {
    const first = availableAgents[0];
    if (!first) throw new Error('Mock planner: no agents available in registry');
    const cost = first.pricing.price_per_call;
    // Keep the stub within budget so it passes validatePlan's cost check.
    if (cost > budget) {
      throw new Error(
        `Mock planner: first agent cost ($${cost.toFixed(4)}) exceeds budget ($${budget.toFixed(4)})`,
      );
    }
    return {
      steps: [
        {
          step_id: 1,
          agent_id: first.agent_id,
          agent_name: first.name,
          action: 'Return current XLM price',
          depends_on: null,
          estimated_cost: cost,
          payment_method: first.pricing.model,
        },
      ],
      total_estimated_cost: cost,
      reasoning:
        'Mock plan (LLM_PROVIDER=mock): single-step stub using the first registered agent.',
    };
  }

  // Score and rank all agents so Claude can respect marketplace selection order.
  // Agents with the same capabilities are ranked: rank 1 = best marketplace score.
  const scored = scoreAgents(availableAgents, [], budget / Math.max(1, availableAgents.length));
  const rankMap = new Map(scored.map((s, i) => [s.agent.agent_id, i + 1]));

  const agentList = scored.map((s) => ({
    agent_id: s.agent.agent_id,
    name: s.agent.name,
    description: s.agent.description,
    capabilities: s.agent.capabilities,
    payment_method: s.agent.pricing.model,
    price_per_call: s.agent.pricing.price_per_call,
    reputation_score: s.agent.reputation?.score ?? 50,
    marketplace_score: s.score, // composite score from selector algorithm
    selection_rank: rankMap.get(s.agent.agent_id) ?? 99, // 1 = best
  }));

  const prompt = `${STELLAR_CONTEXT}

You are a task planner. Decompose the user's task into a minimal sequence of steps using only the available agents listed below.

AVAILABLE AGENTS:
${JSON.stringify(agentList, null, 2)}

TASK: "${task}"
BUDGET: $${budget} USDC total

RULES:
1. Only use agent_ids from the list above — NEVER invent agent_ids.
2. Use the FEWEST agents necessary.
3. Steps that can run independently (no shared inputs) must have depends_on: null.
4. Steps that need output from a prior step must reference that step_id in depends_on.
5. Total estimated_cost must not exceed budget.
6. Each step's payment_method must match the agent's pricing model exactly.
7. Return ONLY valid JSON — no markdown fences, no explanation.
8. IMPORTANT — When multiple agents can fulfill the same role (overlapping capabilities), ALWAYS choose the agent with the LOWEST selection_rank. Rank 1 is the marketplace's top-rated agent. Never choose a higher-ranked (worse) agent when a lower-ranked (better) one covers the same capability.

Return a JSON object with this exact shape:
{
  "steps": [
    {
      "step_id": 1,
      "agent_id": "<exact agent_id>",
      "agent_name": "<agent name>",
      "action": "<clear instruction for the agent>",
      "depends_on": null,
      "estimated_cost": 0.02,
      "payment_method": "x402"
    }
  ],
  "total_estimated_cost": 0.02,
  "reasoning": "<one sentence explaining the plan>"
}`;

  const response = await anthropic.messages.create({
    model: process.env.LLM_PLANNER_MODEL ?? process.env.LLM_MODEL ?? 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return parsePlan(text, availableAgents);
}

function parsePlan(text: string, agents: AgentRecord[]): ExecutionPlan {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  let plan: ExecutionPlan;
  try {
    plan = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Planner returned non-JSON response');
    plan = JSON.parse(match[0]);
  }

  // Normalise depends_on: ensure it's null or number[]
  const agentIds = new Set(agents.map((a) => a.agent_id));
  plan.steps = plan.steps.map((step) => {
    let depends_on: number | number[] | null = step.depends_on;
    if (depends_on !== null && !Array.isArray(depends_on)) {
      depends_on = [depends_on as number];
    }

    // Verify agent_id exists
    if (!agentIds.has(step.agent_id)) {
      throw new Error(`Planner used unknown agent_id: ${step.agent_id}`);
    }

    return { ...step, depends_on };
  });

  return plan;
}
