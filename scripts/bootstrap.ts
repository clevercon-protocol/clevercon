#!/usr/bin/env tsx
/**
 * AgentForge Bootstrap — builds reputation history by running 20+ diverse tasks.
 *
 * Usage:
 *   npx tsx scripts/bootstrap.ts
 *   npx tsx scripts/bootstrap.ts --auto-approve   # approve all plans without waiting
 *   npx tsx scripts/bootstrap.ts --delay 5000      # ms between tasks (default: 8000)
 *
 * Requirements:
 *   - All services must be running (./scripts/start.sh)
 *   - ANTHROPIC_API_KEY must be set in .env
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const WS_URL = ORCHESTRATOR_URL.replace(/^http/, 'ws') + '/ws';
const DEFAULT_DELAY_MS = 8_000;
const APPROVAL_TIMEOUT_MS = 10_000; // How long to wait for plan before auto-approving

const args = process.argv.slice(2);
const AUTO_APPROVE = args.includes('--auto-approve');
const delayArg = args.find(a => a.startsWith('--delay='));
const TASK_DELAY_MS = delayArg
  ? parseInt(delayArg.split('=')[1])
  : DEFAULT_DELAY_MS;

// ── Task catalog ───────────────────────────────────────────────────────────────
// 25 diverse tasks covering all agent capabilities

const TASKS = [
  // Stellar Oracle — blockchain data
  { task: 'What is the current price of XLM in USD?', budget: 0.10 },
  { task: 'Show me the top trading pairs on the Stellar DEX by volume.', budget: 0.15 },
  { task: 'What is the current XLM/USDC exchange rate on the Stellar DEX?', budget: 0.10 },
  { task: 'Get the Stellar network stats including ledger count and transaction throughput.', budget: 0.10 },
  { task: 'What are the current BTC and ETH prices according to the Stellar oracle?', budget: 0.10 },

  // Web Intel — news retrieval
  { task: 'Get the latest blockchain news headlines.', budget: 0.15 },
  { task: 'What are the top crypto news stories today?', budget: 0.15 },
  { task: 'Fetch the latest news about Stellar (XLM) and summarise the key developments.', budget: 0.20 },
  { task: 'What are the latest AI and technology news headlines?', budget: 0.15 },
  { task: 'Get recent news about DeFi and decentralised finance.', budget: 0.15 },

  // Multi-agent: fetch + analysis
  {
    task: 'Fetch the latest blockchain news and analyse the overall sentiment — is the market bullish or bearish?',
    budget: 0.40,
  },
  {
    task: 'Get the current XLM price and analyse whether it represents a good entry point based on recent trends.',
    budget: 0.40,
  },
  {
    task: 'Fetch today\'s crypto news and identify the three most significant market-moving events.',
    budget: 0.40,
  },

  // Multi-agent: fetch + analysis + report
  {
    task: 'Research the current state of the Stellar ecosystem — get news and on-chain data, then write a structured briefing report.',
    budget: 0.60,
  },
  {
    task: 'Get the latest blockchain and crypto news, analyse the key trends, and produce an executive summary report.',
    budget: 0.60,
  },
  {
    task: 'Fetch the current XLM price and Stellar DEX activity, then produce a brief market report.',
    budget: 0.60,
  },

  // Analysis-heavy
  {
    task: 'Analyse the current Stellar DEX liquidity and identify the most actively traded asset pairs.',
    budget: 0.50,
  },
  {
    task: 'Compare the price of XLM across multiple sources and highlight any discrepancies.',
    budget: 0.40,
  },

  // Reporter-only style
  {
    task: 'Summarise what AgentForge is in one paragraph suitable for a hackathon submission.',
    budget: 0.30,
  },

  // Comprehensive pipeline tasks
  {
    task: 'Research recent developments in crypto payments and write a report covering news, sentiment, and market implications.',
    budget: 0.80,
  },
  {
    task: 'Get the latest tech and AI news, perform a trend analysis, and produce a formatted weekly digest.',
    budget: 0.80,
  },
  {
    task: 'Fetch Stellar network statistics and recent XLM price data, analyse the correlation, and write a concise market brief.',
    budget: 0.70,
  },
  {
    task: 'What is the overall health of the Stellar network today? Include price, DEX volume, and network stats in your answer.',
    budget: 0.50,
  },
  {
    task: 'Gather the top 5 blockchain news stories, rate their market impact, and produce a risk assessment report.',
    budget: 0.80,
  },
  {
    task: 'Perform a comprehensive analysis of the current crypto market using Stellar oracle data and recent news, then write an investment briefing.',
    budget: 1.00,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function submitTask(task: string, budget: number): Promise<string | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, budget }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      console.error(`  ✗ Submit failed: ${err.error}`);
      return null;
    }
    const data = await res.json();
    return data.task_id as string;
  } catch (err: any) {
    console.error(`  ✗ Submit error: ${err.message}`);
    return null;
  }
}

async function approveTask(taskId: string): Promise<void> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/tasks/${taskId}/approve`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log(`  ✓ Plan approved for ${taskId}`);
    }
  } catch {
    // Plan may have already auto-approved — ignore
  }
}

// ── WebSocket task watcher ────────────────────────────────────────────────────

interface TaskTracker {
  resolve: (result: 'complete' | 'error' | 'infeasible') => void;
  taskId: string;
  approved: boolean;
  approvalTimer?: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, TaskTracker>();

function connectWS(onReady: () => void): WebSocket {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[ws] Connected to ${WS_URL}`);
    onReady();
  });

  ws.on('message', (raw: Buffer) => {
    let msg: { event: string; data: any };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { event, data } = msg;
    const tracker = data?.task_id ? pending.get(data.task_id) : null;

    switch (event) {
      case 'plan_approval_required': {
        if (!tracker) break;
        const delay = AUTO_APPROVE ? 500 : APPROVAL_TIMEOUT_MS;
        console.log(`  → Plan ready. Auto-approving in ${delay / 1000}s...`);
        tracker.approvalTimer = setTimeout(() => {
          approveTask(tracker.taskId);
          tracker.approved = true;
        }, delay);
        break;
      }

      case 'plan_approved':
      case 'plan_auto_approved':
        if (tracker && !tracker.approved) {
          console.log(`  → Plan approved`);
          tracker.approved = true;
        }
        break;

      case 'task_complete':
        if (tracker) {
          clearTimeout(tracker.approvalTimer);
          const cost = (data.total_cost ?? 0).toFixed(4);
          const ms = data.total_time_ms ?? '?';
          console.log(`  ✓ Complete — cost: $${cost} | time: ${ms}ms`);
          pending.delete(data.task_id);
          tracker.resolve('complete');
        }
        break;

      case 'task_infeasible':
        if (tracker) {
          clearTimeout(tracker.approvalTimer);
          const missing = (data.missing ?? []).join(', ');
          console.log(`  ✗ Infeasible — missing: ${missing}`);
          pending.delete(data.task_id);
          tracker.resolve('infeasible');
        }
        break;

      case 'task_error':
        if (tracker) {
          clearTimeout(tracker.approvalTimer);
          console.log(`  ✗ Error — ${data.error}`);
          pending.delete(data.task_id);
          tracker.resolve('error');
        }
        break;
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`[ws] Error: ${err.message}`);
  });

  ws.on('close', () => {
    console.log(`[ws] Disconnected`);
  });

  return ws;
}

function waitForTask(taskId: string): Promise<'complete' | 'error' | 'infeasible'> {
  return new Promise(resolve => {
    pending.set(taskId, { resolve, taskId, approved: false });
    // Safety timeout: resolve as error if nothing happens in 3 minutes
    const safety = setTimeout(() => {
      if (pending.has(taskId)) {
        console.log(`  ⚠ Task ${taskId} timed out after 3 minutes`);
        pending.delete(taskId);
        resolve('error');
      }
    }, 180_000);
    // Patch the resolve to also clear safety timer
    const tracker = pending.get(taskId)!;
    const orig = tracker.resolve;
    tracker.resolve = (r) => { clearTimeout(safety); orig(r); };
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  AgentForge Bootstrap                  ║');
  console.log(`║  ${TASKS.length} tasks · ${TASK_DELAY_MS / 1000}s gap · ${AUTO_APPROVE ? 'auto-approve' : `${APPROVAL_TIMEOUT_MS / 1000}s plan timeout`}    ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // Health check
  console.log('[bootstrap] Checking orchestrator...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('[bootstrap] Orchestrator is not responding at', ORCHESTRATOR_URL);
    console.error('[bootstrap] Run ./scripts/start.sh first, then re-run this script.');
    process.exit(1);
  }
  console.log('[bootstrap] Orchestrator is healthy\n');

  // Connect WebSocket and wait for it to open
  let wsReady = false;
  const ws = await new Promise<WebSocket>((resolve) => {
    const socket = connectWS(() => {
      wsReady = true;
      resolve(socket);
    });
  });

  const stats = { total: 0, complete: 0, error: 0, infeasible: 0 };

  for (let i = 0; i < TASKS.length; i++) {
    const { task, budget } = TASKS[i];
    stats.total++;

    console.log(`[${i + 1}/${TASKS.length}] ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
    console.log(`  budget: $${budget.toFixed(2)}`);

    const taskId = await submitTask(task, budget);
    if (!taskId) {
      stats.error++;
      console.log('');
      continue;
    }

    console.log(`  task_id: ${taskId}`);

    const result = await waitForTask(taskId);
    stats[result]++;
    console.log('');

    // Delay between tasks (skip delay after last task)
    if (i < TASKS.length - 1) {
      process.stdout.write(`[bootstrap] Waiting ${TASK_DELAY_MS / 1000}s before next task...`);
      await sleep(TASK_DELAY_MS);
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
    }
  }

  ws.close();

  console.log('═══════════════════════════════════════════');
  console.log('  Bootstrap complete');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total:      ${stats.total}`);
  console.log(`  Complete:   ${stats.complete}`);
  console.log(`  Errors:     ${stats.error}`);
  console.log(`  Infeasible: ${stats.infeasible}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  Open http://localhost:3000 to see agent reputation scores.');
  console.log('');
}

main().catch(err => {
  console.error('[bootstrap] Fatal:', err.message);
  process.exit(1);
});
