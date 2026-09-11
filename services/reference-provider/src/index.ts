import { createProvider } from '@clevercon/agent-sdk/provider';

/**
 * Reference provider: the minimal thing that makes a service on the CleverCon
 * marketplace real, now built on the SDK's createProvider so it doubles as the
 * canonical example of the fulfillment contract. A buyer's hire runs against
 * this live endpoint, and when the task is on-chain-locked the provider is paid
 * on settlement.
 *
 * The SDK handles the health check, body parsing, encoding, and error-to-500
 * mapping; the only thing written here is the work itself. This provider does
 * trivial work (it echoes the requested action with a timestamp); a real
 * provider would do the actual job here (a data lookup, an LLM call, etc.). The
 * rail mechanics are identical regardless of what the work is.
 */
const PORT = Number(process.env.PROVIDER_PORT ?? 4200);
const NAME = process.env.PROVIDER_NAME ?? 'reference-provider';

const provider = createProvider({
  name: NAME,
  port: PORT,
  fulfill({ action, taskId }) {
    // The real work would happen here. We return a deterministic result so the
    // buyer sees a concrete output for the step.
    return {
      provider: NAME,
      action,
      taskId,
      result: `Fulfilled "${action}"`,
      at: new Date().toISOString(),
    };
  },
});

provider.listen(PORT);
