/**
 * The smallest useful MPP agent: a manifest, a handler, a wallet. The SDK adds
 * `/health`, `GET /`, the MPP paywall on `POST /task`, self-registration with
 * retry/backoff, and graceful deregistration on SIGTERM.
 */
import 'dotenv/config';
import { createAgent } from '@clevercon/agent-sdk';

const SECRET_KEY = process.env.EXAMPLE_MPP_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('[echo-mpp] EXAMPLE_MPP_SECRET_KEY not set');
  process.exit(1);
}

export const agent = createAgent({
  manifest: {
    agent_id: 'echo-mpp',
    name: 'EchoMpp',
    description: 'Minimal MPP example agent — echoes the instruction back.',
  },
  capabilities: ['echo', 'demo'],
  price: 0.005,
  payment: 'mpp',
  wallet: { secretKey: SECRET_KEY },
  port: Number(process.env.EXAMPLE_MPP_PORT ?? process.env.PORT ?? 4010),
  taskPath: '/task',
  handler: (task) => ({
    echo: task.query || task.body,
    received_at: new Date().toISOString(),
  }),
});

if (process.env.NODE_ENV !== 'test') {
  agent.listen();
}
