import axios from 'axios';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3000';
const AGENT_ID = process.env.AGENT_ID || 'agent-core-01';

/**
 * Registers startup configuration and provisions automatic lifecycle loops
 */
export function initializeAgentHeartbeat() {
  console.log(`[Lifecycle] Initializing background pulse telemetry for Agent: ${AGENT_ID}`);

  // Establish heartbeat cycle matching the 60-second execution window specifications
  const heartbeatInterval = setInterval(async () => {
    try {
      await axios.post(`${REGISTRY_URL}/agents/${AGENT_ID}/heartbeat`);
    } catch (error: any) {
      console.warn(`[Lifecycle Warning] Pulse telemetry transmission dropped: ${error.message}`);
    }
  }, 60000);

  // Structural Cleanup Management: Clear event pools if process triggers termination signals
  process.on('SIGTERM', () => {
    clearInterval(heartbeatInterval);
  });
  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
  });
}