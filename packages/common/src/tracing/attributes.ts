/**
 * CleverCon OpenTelemetry semantic attribute names.
 *
 * Keep these attributes:
 * - bounded
 * - searchable
 * - non-sensitive
 * - low-cardinality where possible
 */

export const TRACE_ATTRIBUTES = {
  TASK_ID: 'clevercon.task.id',
  STEP_ID: 'clevercon.step.id',
  AGENT_ID: 'clevercon.agent.id',
  ASSET: 'clevercon.asset',
  AMOUNT: 'clevercon.amount',

  AGENT_PROTOCOL: 'clevercon.agent.protocol',

  VAULT_NETWORK: 'clevercon.vault.network',
  VAULT_OPERATION: 'clevercon.vault.operation',
} as const;

export type TraceAttributes = Record<
  string,
  string | number | boolean | undefined
>;

function boundedString(
  value: unknown,
  maxLength = 128,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const stringValue = String(value);

  if (!stringValue) {
    return undefined;
  }

  return stringValue.slice(0, maxLength);
}

export function taskAttributes(taskId: unknown): TraceAttributes {
  const value = boundedString(taskId);

  return value
    ? {
        [TRACE_ATTRIBUTES.TASK_ID]: value,
      }
    : {};
}

export function stepAttributes(
  taskId: unknown,
  stepId: unknown,
): TraceAttributes {
  return {
    ...taskAttributes(taskId),
    ...(boundedString(stepId)
      ? {
          [TRACE_ATTRIBUTES.STEP_ID]: boundedString(stepId),
        }
      : {}),
  };
}

export function agentAttributes(
  taskId: unknown,
  stepId: unknown,
  agentId: unknown,
  protocol?: unknown,
): TraceAttributes {
  return {
    ...stepAttributes(taskId, stepId),

    ...(boundedString(agentId)
      ? {
          [TRACE_ATTRIBUTES.AGENT_ID]: boundedString(agentId),
        }
      : {}),

    ...(boundedString(protocol)
      ? {
          [TRACE_ATTRIBUTES.AGENT_PROTOCOL]: boundedString(protocol, 32),
        }
      : {}),
  };
}

export function vaultAttributes(options: {
  taskId?: unknown;
  stepId?: unknown;
  agentId?: unknown;
  asset?: unknown;
  amount?: unknown;
  network?: unknown;
  operation?: unknown;
}): TraceAttributes {
  return {
    ...stepAttributes(options.taskId, options.stepId),

    ...(boundedString(options.agentId)
      ? {
          [TRACE_ATTRIBUTES.AGENT_ID]: boundedString(options.agentId),
        }
      : {}),

    ...(boundedString(options.asset, 32)
      ? {
          [TRACE_ATTRIBUTES.ASSET]: boundedString(options.asset, 32),
        }
      : {}),

    ...(options.amount !== undefined && options.amount !== null
      ? {
          [TRACE_ATTRIBUTES.AMOUNT]: boundedString(options.amount, 64),
        }
      : {}),

    ...(boundedString(options.network, 32)
      ? {
          [TRACE_ATTRIBUTES.VAULT_NETWORK]: boundedString(
            options.network,
            32,
          ),
        }
      : {}),

    ...(boundedString(options.operation, 64)
      ? {
          [TRACE_ATTRIBUTES.VAULT_OPERATION]: boundedString(
            options.operation,
            64,
          ),
        }
      : {}),
  };
}