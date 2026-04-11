import type { AgentRecord, ExecutionPlan } from '@clevercon/common';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePlan(
  plan: ExecutionPlan,
  availableAgents: AgentRecord[],
  budget: number,
): ValidationResult {
  const errors: string[] = [];
  const agentMap = new Map(availableAgents.map(a => [a.agent_id, a]));
  const stepIds = new Set(plan.steps.map(s => s.step_id));

  // 1. All agent_ids must exist in registry
  for (const step of plan.steps) {
    if (!agentMap.has(step.agent_id)) {
      errors.push(`Step ${step.step_id}: unknown agent_id "${step.agent_id}"`);
    }
  }

  // 2. Total cost must not exceed budget
  if (plan.total_estimated_cost > budget) {
    errors.push(
      `Estimated cost $${plan.total_estimated_cost.toFixed(4)} exceeds budget $${budget.toFixed(4)}`
    );
  }

  // 3. No circular dependencies
  for (const step of plan.steps) {
    const deps = step.depends_on === null
      ? []
      : Array.isArray(step.depends_on)
        ? step.depends_on
        : [step.depends_on];

    for (const dep of deps) {
      // Dependency must reference an earlier step_id
      if (!stepIds.has(dep)) {
        errors.push(`Step ${step.step_id}: depends_on unknown step_id ${dep}`);
      }
      if (dep >= step.step_id) {
        errors.push(`Step ${step.step_id}: depends_on step ${dep} which is not earlier (circular or forward reference)`);
      }
    }
  }

  // 4. Payment method must match agent's pricing model
  for (const step of plan.steps) {
    const agent = agentMap.get(step.agent_id);
    if (agent && agent.pricing.model !== step.payment_method) {
      errors.push(
        `Step ${step.step_id}: payment_method "${step.payment_method}" does not match agent "${step.agent_id}" model "${agent.pricing.model}"`
      );
    }
  }

  // 5. Plan must have at least one step
  if (plan.steps.length === 0) {
    errors.push('Plan has no steps');
  }

  return { valid: errors.length === 0, errors };
}
