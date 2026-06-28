/**
 * Orchestrator HTTP + WebSocket server.
 * POST /api/tasks                   — submit a task for execution
 * POST /api/tasks/:id/approve       — approve the pending execution plan
 * POST /api/tasks/:id/reject        — reject the pending execution plan
 * GET    /api/agents                — list registered agents from registry
 * DELETE /api/agents/:id            — remove an agent from registry
 * POST   /api/provision-wallet      — provision a sponsored Stellar wallet
 * GET    /api/wallets               — show orchestrator wallet info
 * GET    /api/orchestrators/:addr   — check if user has a personal orchestrator
 * POST   /api/orchestrators         — create a personal orchestrator for a user
 * POST   /api/orchestrators/confirm — submit signed on-chain registration XDR
 * GET  /health                      — liveness check
 * WS   /ws                          — real-time task event stream
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// process.argv[1] is the entry script path — works in both tsx (ESM) and node (CJS)
const __dirname = path.dirname(path.resolve(process.argv[1]));
import {
  Keypair,
  Account,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Asset,
  Operation,
} from '@stellar/stellar-sdk';
import type { AgentRecord } from '@clevercon/common';
import { accountExplorerUrl } from '@clevercon/common';
import { checkFeasibility } from './capability-check.js';
import { createPlan } from './planner.js';
import { validatePlan } from './validator.js';
import { PlanExecutor } from './executor.js';
import { scoreAgents } from './selector.js';
import {
  createTask as vaultCreateTask,
  completeTask as vaultCompleteTask,
  getAvailable,
  VAULT_ACTIVE,
} from './agent-vault-client.js';
import * as orchestratorStore from './orchestrator-store.js';
import * as activityStore from './activity-store.js';
import { appendVaultTx, getVaultLedger } from './vault-ledger.js';
import { saveTaskResult, getTaskResults, deleteTaskResult } from './task-results.js';

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || process.env.PORT || '3000');
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const BUDGET_DEFAULT = parseFloat(process.env.DEFAULT_BUDGET || '1.0');
const SECRET_KEY = process.env.ORCHESTRATOR_SECRET_KEY;
// How long to wait for user to approve a plan before auto-approving (ms)
const APPROVAL_TIMEOUT_MS = parseInt(process.env.PLAN_APPROVAL_TIMEOUT_MS || '60000');

if (!SECRET_KEY && !process.env.VITEST) {
  console.error('[Orchestrator] ORCHESTRATOR_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY || Keypair.random().secret());
const ORCHESTRATOR_ADDRESS = keypair.publicKey();

// ── USDC helpers ───────────────────────────────────────────────────────────────

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_ASSET = new Asset('USDC', USDC_ISSUER);

/** Submit a changeTrust(USDC) transaction signed by the given keypair. */
async function addUsdcTrustline(signerKeypair: Keypair): Promise<void> {
  const address = signerKeypair.publicKey();
  const accountRes = await fetch(`${HORIZON_URL}/accounts/${address}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!accountRes.ok) throw new Error(`Account not found: ${address}`);
  const accountData = await accountRes.json();

  // Check if trust line already exists
  const balances: any[] = accountData.balances ?? [];
  const hasTrustline = balances.some(
    (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  if (hasTrustline) return; // Already set up

  const account = new Account(accountData.account_id, accountData.sequence);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();

  tx.sign(signerKeypair);
  const xdr = tx.toEnvelope().toXDR('base64');

  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(xdr)}`,
    signal: AbortSignal.timeout(30000),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`changeTrust failed: ${text.slice(0, 300)}`);
  }
}

/**
 * Request testnet USDC from the Circle testnet faucet.
 * This is a best-effort call — if the faucet is unavailable we just log and continue.
 *
 * NOTE: Circle's faucet UI lives at https://faucet.circle.com — there is no stable
 * public JSON API. This function attempts the call anyway and parses the response;
 * if it returns HTML (the Next.js frontend) or any non-JSON body, we log a manual
 * funding reminder instead of a misleading success message.
 */
async function requestTestnetUsdc(address: string): Promise<void> {
  const FAUCET_URL = 'https://faucet.circle.com/api/faucet/testnet';
  try {
    const res = await fetch(FAUCET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, blockchain: 'STELLAR', amount: '10' }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text().catch(() => '');
    // Only treat it as success if the response looks like JSON with a success indicator.
    // The faucet site sometimes returns 200 HTML (Next.js page) which is a false positive.
    let succeeded = false;
    if (res.ok && text.trimStart().startsWith('{')) {
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        succeeded = json['success'] === true || json['status'] === 'ok' || json['txHash'] != null;
      } catch {
        // not valid JSON
      }
    }
    if (succeeded) {
      console.log(
        `[Orchestrator] Circle faucet: requested 10 testnet USDC for ${address.slice(0, 8)}…`,
      );
    } else {
      console.warn(
        `[Orchestrator] Circle faucet auto-request did not confirm. ` +
          `Fund the orchestrator manually: https://faucet.circle.com → Stellar Testnet → paste ${address}`,
      );
    }
  } catch (err: any) {
    console.warn(`[Orchestrator] Circle faucet unavailable: ${err.message}`);
  }
}

/**
 * Ensure the shared orchestrator wallet has a USDC trustline and some testnet USDC.
 * Called once on startup. Non-fatal — logs warnings but doesn't crash.
 */
async function setupSharedWallet(walletKeypair: Keypair): Promise<void> {
  const address = walletKeypair.publicKey();
  try {
    // Check if account exists; if not, friendbot it first
    const accountRes = await fetch(`${HORIZON_URL}/accounts/${address}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!accountRes.ok) {
      console.log(
        `[Orchestrator] Shared wallet not found — running friendbot for ${address.slice(0, 8)}…`,
      );
      const fb = await fetch(`${HORIZON_URL}/friendbot?addr=${address}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);
      console.log(`[Orchestrator] Shared wallet funded via friendbot`);
      // Small delay for ledger to close
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Ensure USDC trustline
    await addUsdcTrustline(walletKeypair);
    console.log(`[Orchestrator] USDC trustline confirmed for shared wallet`);

    // Check current USDC balance
    const acctRes2 = await fetch(`${HORIZON_URL}/accounts/${address}`, {
      signal: AbortSignal.timeout(10000),
    });
    const acctData = await acctRes2.json();
    const balances: any[] = acctData.balances ?? [];
    const xlm = balances.find((b: any) => b.asset_type === 'native');
    const usdc = balances.find((b: any) => b.asset_code === 'USDC');
    const usdcBal = parseFloat(usdc?.balance ?? '0');

    console.log(`[Orchestrator] Shared wallet — XLM: ${xlm?.balance ?? 'N/A'}, USDC: ${usdcBal}`);

    // Request testnet USDC if balance is low
    if (usdcBal < 1) {
      console.log(
        `[Orchestrator] USDC balance low (${usdcBal}) — requesting from Circle testnet faucet…`,
      );
      await requestTestnetUsdc(address);
    }
  } catch (err: any) {
    console.warn(`[Orchestrator] Shared wallet setup warning: ${err.message}`);
  }
}

/** Build an unsigned changeTrust(USDC) XDR for the given user address, to be signed by Freighter. */
async function buildUsdcTrustlineXdr(userAddress: string): Promise<string> {
  const accountRes = await fetch(`${HORIZON_URL}/accounts/${userAddress}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!accountRes.ok) throw new Error(`Account not found: ${userAddress}`);
  const accountData = await accountRes.json();

  const account = new Account(accountData.account_id, accountData.sequence);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();

  return tx.toEnvelope().toXDR('base64');
}

// ── Registry helpers ──────────────────────────────────────────────────────────

async function fetchAgents(): Promise<AgentRecord[]> {
  const response = await fetch(`${REGISTRY_URL}/agents`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Registry returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : (data.agents ?? []);
}

// ── WebSocket broadcast ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(event: string, data: unknown) {
  // BigInt replacer — prevents JSON.stringify from throwing on BigInt values
  const message = JSON.stringify(
    { event, data, timestamp: new Date().toISOString() },
    (_key, value) => (typeof value === 'bigint' ? Number(value) : value),
  );
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ── Plan approval gate ────────────────────────────────────────────────────────

interface PendingApproval {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

function waitForApproval(task_id: string, planPayload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    // Auto-approve after timeout
    const timer = setTimeout(() => {
      if (pendingApprovals.has(task_id)) {
        pendingApprovals.delete(task_id);
        broadcast('plan_auto_approved', { task_id, reason: 'timeout' });
        resolve();
      }
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(task_id, { resolve, reject, timer });
    broadcast('plan_approval_required', planPayload);
  });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard static files if built
const dashboardPath = path.join(__dirname, '..', 'public');
app.use(express.static(dashboardPath));
// SPA fallback — but only for non-API routes
app.get('/', (_req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err)
      res
        .status(404)
        .json({ error: 'Dashboard not built. Run npm run build in packages/dashboard.' });
  });
});

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'Orchestrator', address: ORCHESTRATOR_ADDRESS });
});

// List agents from registry
app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await fetchAgents();
    res.json({ agents, count: agents.length });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

// Wallet info
app.get('/api/wallets', (_req, res) => {
  res.json({
    orchestrator: {
      address: ORCHESTRATOR_ADDRESS,
      network: 'stellar:testnet',
      explorer_url: accountExplorerUrl(ORCHESTRATOR_ADDRESS),
      role: 'payer',
    },
  });
});

// Remove an agent from the registry — requester_address forwarded for ownership check
app.delete('/api/agents/:id', async (req, res) => {
  const { requester_address } = req.body as { requester_address?: string };
  if (!requester_address) {
    return res.status(400).json({ error: 'requester_address is required' });
  }
  try {
    const resp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_address }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 403) return res.status(403).json(await resp.json());
    if (resp.status === 404) return res.status(404).json({ error: 'Agent not found' });
    if (!resp.ok) return res.status(502).json({ error: `Registry returned ${resp.status}` });
    res.json({ deleted: true, agent_id: req.params.id });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

// Register a new agent — proxied to registry
// Accepts both /api/register and /api/agents/register (dashboard uses both)
async function proxyRegister(req: express.Request, res: express.Response) {
  try {
    const resp = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
}
app.post('/api/register', proxyRegister);
app.post('/api/agents/register', proxyRegister);

// Update agent name/description — proxied to registry with ownership check
app.patch('/api/agents/:id', async (req, res) => {
  try {
    const resp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

// Provision a new Stellar wallet via the sponsored account service
app.post('/api/provision-wallet', async (req, res) => {
  try {
    const { provisionAgentWallet } = await import('./wallet-provisioner.js');
    const wallet = await provisionAgentWallet();
    res.json(wallet);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Orchestrator management ───────────────────────────────────────────────────

// Check if a user already has a personal orchestrator
app.get('/api/orchestrators/:user_address', (req, res) => {
  const record = orchestratorStore.getByUser(req.params.user_address);
  if (!record) return res.json({ exists: false });
  res.json({
    exists: true,
    name: record.orchestrator_name,
    pubkey: record.orchestrator_pubkey,
    registered_on_chain: record.registered_on_chain,
    system_prompt: record.system_prompt ?? null,
  });
});

// Create a personal orchestrator for a user
// Generates a fresh Stellar keypair, funds it via Friendbot, stores locally.
// If AGENT_VAULT_CONTRACT_ID is configured, also returns an unsigned
// register_orchestrator XDR for the user to sign in Freighter.
app.post('/api/orchestrators', async (req, res) => {
  const { user_address, name, system_prompt } = req.body as {
    user_address?: string;
    name?: string;
    system_prompt?: string;
  };

  if (!user_address || !name) {
    return res.status(400).json({ error: 'user_address and name are required' });
  }
  if (name.trim().length === 0 || name.length > 30) {
    return res.status(400).json({ error: 'name must be 1–30 characters' });
  }

  // 409 if already created
  if (orchestratorStore.getByUser(user_address)) {
    return res.status(409).json({
      error: 'orchestrator_exists',
      message: 'This user already has a personal orchestrator',
    });
  }

  try {
    // 1. Generate a fresh Stellar keypair
    const orchKeypair = Keypair.random();

    // 2. Fund via Friendbot (gives ~10 000 XLM on testnet)
    const friendbotUrl = `${HORIZON_URL}/friendbot?addr=${orchKeypair.publicKey()}`;
    const fbResp = await fetch(friendbotUrl, { signal: AbortSignal.timeout(15000) });
    if (!fbResp.ok) {
      const text = await fbResp.text();
      throw new Error(`Friendbot failed (${fbResp.status}): ${text.slice(0, 200)}`);
    }

    // 2b. Add USDC trust line and request testnet USDC for the new orchestrator wallet
    try {
      await addUsdcTrustline(orchKeypair);
      console.log(
        `[Orchestrator] USDC trustline added for ${orchKeypair.publicKey().slice(0, 8)}…`,
      );
      // Request testnet USDC from Circle faucet so the wallet can pay agents immediately
      await requestTestnetUsdc(orchKeypair.publicKey());
    } catch (err: any) {
      console.warn('[Orchestrator] Could not set up USDC for new orchestrator:', err.message);
    }

    // 3. Store locally
    orchestratorStore.upsert({
      user_address,
      orchestrator_name: name.trim(),
      orchestrator_pubkey: orchKeypair.publicKey(),
      orchestrator_secret: orchKeypair.secret(),
      system_prompt: system_prompt?.trim() || undefined,
      registered_on_chain: false,
      created_at: new Date().toISOString(),
    });

    console.log(
      `[Orchestrator] Created '${name}' for user ${user_address.slice(0, 8)}… → ${orchKeypair.publicKey().slice(0, 8)}…`,
    );

    // 4. Optionally build on-chain registration XDR (requires contract deployed)
    let registration_xdr: string | null = null;
    const VAULT_ID = process.env.AGENT_VAULT_CONTRACT_ID ?? '';
    if (VAULT_ID.length > 10 && !VAULT_ID.startsWith('C...')) {
      try {
        const { buildRegisterOrchestratorXdr } = await import('./agent-vault-client.js');
        registration_xdr = await buildRegisterOrchestratorXdr(
          user_address,
          orchKeypair.publicKey(),
          name.trim(),
        );
      } catch (err: any) {
        console.warn('[Orchestrator] Could not build registration XDR:', err.message);
        // Non-fatal — contract step is skipped, orchestrator works locally
      }
    }

    res.json({
      orchestrator_pubkey: orchKeypair.publicKey(),
      orchestrator_secret: orchKeypair.secret(), // returned once so client can persist it
      name: name.trim(),
      registration_xdr, // null if contract not configured
    });
  } catch (err: any) {
    console.error('[Orchestrator] Create orchestrator error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Restore a previously-created orchestrator after a server restart / redeploy.
// The client stores the full record in localStorage and re-seeds the server when it forgets.
app.post('/api/orchestrators/restore', (req, res) => {
  const {
    user_address,
    orchestrator_pubkey,
    orchestrator_secret,
    orchestrator_name,
    system_prompt,
    registered_on_chain,
    created_at,
  } = req.body as {
    user_address?: string;
    orchestrator_pubkey?: string;
    orchestrator_secret?: string;
    orchestrator_name?: string;
    system_prompt?: string;
    registered_on_chain?: boolean;
    created_at?: string;
  };

  if (!user_address || !orchestrator_pubkey || !orchestrator_secret || !orchestrator_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate the secret actually matches the pubkey
  try {
    const kp = Keypair.fromSecret(orchestrator_secret);
    if (kp.publicKey() !== orchestrator_pubkey) {
      return res.status(400).json({ error: 'Secret does not match pubkey' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid secret key' });
  }

  orchestratorStore.upsert({
    user_address,
    orchestrator_name,
    orchestrator_pubkey,
    orchestrator_secret,
    system_prompt: system_prompt || undefined,
    registered_on_chain: registered_on_chain ?? false,
    created_at: created_at ?? new Date().toISOString(),
  });

  console.log(
    `[Orchestrator] Restored '${orchestrator_name}' for user ${user_address.slice(0, 8)}… (registered_on_chain=${registered_on_chain})`,
  );
  res.json({ ok: true });
});

// Submit a signed register_orchestrator XDR (user signed in Freighter)
app.post('/api/orchestrators/confirm', async (req, res) => {
  const { user_address, signed_xdr } = req.body as {
    user_address?: string;
    signed_xdr?: string;
  };

  if (!user_address || !signed_xdr) {
    return res.status(400).json({ error: 'user_address and signed_xdr are required' });
  }

  const record = orchestratorStore.getByUser(user_address);
  if (!record) {
    return res.status(404).json({ error: 'No orchestrator found for this user' });
  }

  try {
    const { submitSignedXdr } = await import('./agent-vault-client.js');
    const tx_hash = await submitSignedXdr(signed_xdr);
    orchestratorStore.markRegisteredOnChain(user_address);
    console.log(`[Orchestrator] '${record.orchestrator_name}' registered on-chain: ${tx_hash}`);
    res.json({ success: true, tx_hash });
  } catch (err: any) {
    console.error('[Orchestrator] Confirm registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orchestrators/rename — update orchestrator display name
app.patch('/api/orchestrators/rename', (req, res) => {
  const { user_address, name } = req.body as { user_address?: string; name?: string };
  if (!user_address || !name?.trim()) {
    return res.status(400).json({ error: 'user_address and name are required' });
  }
  const record = orchestratorStore.getByUser(user_address);
  if (!record) return res.status(404).json({ error: 'No orchestrator found' });
  orchestratorStore.upsert({ ...record, orchestrator_name: name.trim() });
  return res.json({ success: true, name: name.trim() });
});

// ── AgentVault API (U4) ───────────────────────────────────────────────────────

// GET /api/vault/account/:user_address — live vault balance & state
app.get('/api/vault/account/:user_address', async (req, res) => {
  try {
    const { getAccount } = await import('./agent-vault-client.js');
    const account = await getAccount(req.params.user_address);
    // null means the contract call itself failed (RPC error) — signal the client
    // to keep its last known balance rather than flashing zero.
    if (account === null) {
      return res.status(503).json({ error: 'rpc_unavailable' });
    }
    res.json(account);
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// POST /api/vault/deposit-xdr — build unsigned deposit XDR
app.post('/api/vault/deposit-xdr', async (req, res) => {
  const { user_address, amount } = req.body as { user_address?: string; amount?: number };
  if (!user_address || !amount || amount <= 0) {
    return res.status(400).json({ error: 'user_address and amount required' });
  }
  try {
    const { buildDepositXdr } = await import('./agent-vault-client.js');
    const xdr = await buildDepositXdr(user_address, amount);
    if (!xdr) return res.status(503).json({ error: 'AgentVault contract not configured' });
    res.json({ xdr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vault/withdraw-xdr — build unsigned withdraw XDR
app.post('/api/vault/withdraw-xdr', async (req, res) => {
  const { user_address, amount } = req.body as { user_address?: string; amount?: number };
  if (!user_address || !amount || amount <= 0) {
    return res.status(400).json({ error: 'user_address and amount required' });
  }
  try {
    const { buildWithdrawXdr } = await import('./agent-vault-client.js');
    const xdr = await buildWithdrawXdr(user_address, amount);
    if (!xdr) return res.status(503).json({ error: 'AgentVault contract not configured' });
    res.json({ xdr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vault/submit — submit a signed XDR (deposit or withdraw)
// Optional body: { user_address, tx_type: 'deposit'|'withdrawal', amount }
app.post('/api/vault/submit', async (req, res) => {
  const { signed_xdr, user_address, tx_type, amount } = req.body as {
    signed_xdr?: string;
    user_address?: string;
    tx_type?: 'deposit' | 'withdrawal';
    amount?: number;
  };
  if (!signed_xdr) return res.status(400).json({ error: 'signed_xdr required' });
  try {
    const { submitSignedXdr } = await import('./agent-vault-client.js');
    const tx_hash = await submitSignedXdr(signed_xdr);

    // Log to vault ledger if caller provided context
    if (user_address && tx_type && amount && amount > 0) {
      appendVaultTx({ user_address, type: tx_type, amount_usdc: amount, tx_hash });
    }

    res.json({ success: true, tx_hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Build unsigned USDC changeTrust XDR for user to sign in Freighter
app.post('/api/orchestrators/usdc-trustline', async (req, res) => {
  const { user_address } = req.body as { user_address?: string };
  if (!user_address) return res.status(400).json({ error: 'user_address is required' });
  try {
    const xdr = await buildUsdcTrustlineXdr(user_address);
    res.json({ xdr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a signed USDC changeTrust XDR from Freighter
app.post('/api/orchestrators/usdc-trustline/confirm', async (req, res) => {
  const { signed_xdr } = req.body as { signed_xdr?: string };
  if (!signed_xdr) return res.status(400).json({ error: 'signed_xdr is required' });
  try {
    const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(signed_xdr)}`,
      signal: AbortSignal.timeout(30000),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      throw new Error(text.slice(0, 300));
    }
    const result = await submitRes.json();
    res.json({ success: true, tx_hash: result.hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Activity log (U7) ────────────────────────────────────────────────────────

// GET /api/activity/:user_address — recent activity for a user
app.get('/api/activity/:user_address', (req, res) => {
  const events = activityStore.getForUser(req.params.user_address, 50);
  res.json({ events });
});

// GET /api/stats/pulse — marketplace-wide stats
app.get('/api/stats/pulse', (_req, res) => {
  res.json(activityStore.getPulse());
});

// ── Vault task management (U7) ────────────────────────────────────────────────

// POST /api/vault/cancel-task-xdr — build unsigned cancel_task XDR
app.post('/api/vault/cancel-task-xdr', async (req, res) => {
  const { user_address, vault_task_id } = req.body as {
    user_address?: string;
    vault_task_id?: number;
  };
  if (!user_address || vault_task_id == null) {
    return res.status(400).json({ error: 'user_address and vault_task_id required' });
  }
  try {
    const { buildCancelTaskXdr } = await import('./agent-vault-client.js');
    const xdr = await buildCancelTaskXdr(user_address, BigInt(vault_task_id));
    if (!xdr) return res.status(503).json({ error: 'AgentVault contract not configured' });
    res.json({ xdr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vault/force-complete — orchestrator-signed force completion of stale task
app.post('/api/vault/force-complete', async (req, res) => {
  const { user_address, vault_task_id } = req.body as {
    user_address?: string;
    vault_task_id?: number;
  };
  if (!user_address || vault_task_id == null) {
    return res.status(400).json({ error: 'user_address and vault_task_id required' });
  }
  const record = orchestratorStore.getByUser(user_address);
  if (!record) {
    return res.status(404).json({ error: 'No orchestrator for this user' });
  }
  try {
    const { forceCompleteTask } = await import('./agent-vault-client.js');
    const orchKeypair = Keypair.fromSecret(record.orchestrator_secret);
    const tx_hash = await forceCompleteTask(orchKeypair, BigInt(vault_task_id));
    if (!tx_hash) return res.status(503).json({ error: 'AgentVault contract not configured' });
    console.log(
      `[Orchestrator] Force-completed vault task ${vault_task_id} for ${user_address.slice(0, 8)}…`,
    );
    res.json({ success: true, tx_hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Vault Ledger ─────────────────────────────────────────────────────────────

// GET /api/vault/ledger/:user_address — real vault transaction history
app.get('/api/vault/ledger/:user_address', (req, res) => {
  const entries = getVaultLedger(req.params.user_address, 100);
  res.json({ entries });
});

// ── Task Results (History tab) ────────────────────────────────────────────────

// GET /api/tasks/history/:user_address — persisted task results for a user
app.get('/api/tasks/history/:user_address', (req, res) => {
  const results = getTaskResults(req.params.user_address, 50);
  res.json({ results });
});

// DELETE /api/tasks/history/:task_id — remove a task from history (owner only)
app.delete('/api/tasks/history/:task_id', (req, res) => {
  const user_address = req.query.user_address as string | undefined;
  if (!user_address) return res.status(400).json({ error: 'user_address query param is required' });
  // Verify the task belongs to this user before deleting
  const results = getTaskResults(user_address, 1000);
  const owned = results.some((r) => r.task_id === req.params.task_id);
  if (!owned) return res.status(403).json({ error: 'Not authorised or task not found' });
  const deleted = deleteTaskResult(req.params.task_id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

// Preview a task — feasibility + plan only, no vault/execution. Used by QueueReviewModal.
app.post('/api/tasks/preview', async (req, res) => {
  const { task, prompt, budget } = req.body as {
    task?: string;
    prompt?: string;
    budget?: number;
  };
  const taskText = task ?? prompt;
  if (!taskText || typeof taskText !== 'string' || taskText.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }
  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;

  let agents: AgentRecord[];
  try {
    agents = await fetchAgents();
  } catch (err: any) {
    return res.status(503).json({ error: 'registry_unavailable', message: err.message });
  }
  if (agents.length === 0)
    return res.status(503).json({ error: 'no_agents', message: 'No agents registered' });

  const agentMap = new Map(agents.map((a) => [a.agent_id, a]));

  let feasibility;
  try {
    feasibility = await checkFeasibility(taskText, agents);
  } catch (err: any) {
    return res.status(500).json({ error: 'feasibility_failed', message: err.message });
  }

  if (!feasibility.feasible) {
    return res.status(422).json({
      feasible: false,
      missing: feasibility.missing,
      message: `Cannot complete — missing: ${feasibility.missing.join(', ')}`,
    });
  }

  let plan;
  try {
    plan = await createPlan(taskText, agents, taskBudget);
  } catch (err: any) {
    return res.status(500).json({ error: 'planning_failed', message: err.message });
  }

  return res.json({
    feasible: true,
    total_estimated_cost: plan.total_estimated_cost,
    steps: plan.steps.map((s) => ({
      agent_id: s.agent_id,
      agent_name: s.agent_name,
      action: s.action,
      estimated_cost: s.estimated_cost,
      payment_method: s.payment_method,
      endpoint: agentMap.get(s.agent_id)?.endpoint ?? null,
    })),
    reasoning: plan.reasoning,
    over_budget: plan.total_estimated_cost > taskBudget,
    budget: taskBudget,
  });
});

/** Validate webhook_url parameter */
export function validateWebhookUrl(webhook_url: any): boolean {
  if (webhook_url === undefined) return true;
  if (typeof webhook_url !== 'string') return false;
  try {
    const parsed = new URL(webhook_url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();

    // Allow loopback/private destinations only in development or test environments
    if (process.env.NODE_ENV === 'development' || process.env.VITEST) {
      return true;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return false;
    }

    // Check RFC1918 private IPv4 addresses (10.x.x.x, 192.168.x.x, 172.16.x.x-172.31.x.x)
    // Check link-local IP (169.254.x.x)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
      const [, p1, p2, p3, p4] = match.map(Number);
      if (p1 > 255 || p2 > 255 || p3 > 255 || p4 > 255) return false;
      if (p1 === 127 || p1 === 10 || p1 === 0) return false;
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
      if (p1 === 192 && p2 === 168) return false;
      if (p1 === 169 && p2 === 254) return false;
    }

    // Check IPv6 loopback, link-local, and unique local addresses
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const ipv6 = hostname.slice(1, -1);
      if (ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1') return false;
      if (ipv6.startsWith('fe80:') || ipv6.startsWith('fc00:') || ipv6.startsWith('fd00:'))
        return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Submit a task
app.post('/api/tasks', async (req, res) => {
  const { task, budget, user_address, webhook_url } = req.body as {
    task?: string;
    budget?: number;
    user_address?: string;
    webhook_url?: string;
  };

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }

  if (!validateWebhookUrl(webhook_url)) {
    return res.status(400).json({ error: 'webhook_url must be a valid URL' });
  }

  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;

  // ── Per-user orchestrator lookup (U5) ──────────────────────────────────────
  if (user_address) {
    const record = orchestratorStore.getByUser(user_address);
    if (!record) {
      return res
        .status(400)
        .json({ error: 'no_orchestrator', message: 'Create your orchestrator first' });
    }

    // Pre-flight: vault balance check
    if (VAULT_ACTIVE) {
      try {
        const available = await getAvailable(user_address);
        const availableUsdc = Number(available) / 10_000_000;
        if (availableUsdc < taskBudget) {
          return res.status(402).json({
            error: 'insufficient_vault_balance',
            available: availableUsdc,
            required: taskBudget,
            shortfall: taskBudget - availableUsdc,
          });
        }
      } catch (err: any) {
        console.warn('[Orchestrator] Vault balance check failed (continuing):', err.message);
        // Non-fatal — let the task proceed if RPC is unreachable
      }
    }
  }

  const task_id = uuidv4();
  res.status(202).json({ status: 'accepted', task_id, task, budget: taskBudget });
  broadcast('task_accepted', { task_id, task, budget: taskBudget });

  runTask(task_id, task, taskBudget, user_address ?? null, webhook_url).catch((err) => {
    console.error('[Orchestrator] Task pipeline error:', err.message);
    broadcast('task_error', { task_id, task, error: err.message });
  });
});

// Approve a pending plan
app.post('/api/tasks/:id/approve', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval for this task' });
  }
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_approved', { task_id: id });
  pending.resolve();
  res.json({ status: 'approved', task_id: id });
});

// Reject a pending plan
app.post('/api/tasks/:id/reject', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval for this task' });
  }
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_rejected', { task_id: id });
  pending.reject(new Error('Plan rejected by user'));
  res.json({ status: 'rejected', task_id: id });
});

// ── Task pipeline ────────────────────────────────────────────────────────────

/**
 * Asynchronously sends task result to the webhook URL with retry logic.
 */
export async function sendWebhookWithRetry(webhookUrl: string, payload: unknown): Promise<void> {
  const send = async (): Promise<{ status?: number; error?: any }> => {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      await response.text().catch(() => {});
      return { status: response.status };
    } catch (err) {
      return { error: err };
    }
  };

  let result = await send();
  const isNetworkError = result.error !== undefined;
  const is5xx = result.status !== undefined && result.status >= 500 && result.status < 600;

  if (isNetworkError || is5xx) {
    const reason = isNetworkError
      ? `error: ${(result.error as Error).message ?? String(result.error)}`
      : `HTTP status: ${result.status}`;
    console.warn(`[Orchestrator] Webhook delivery failed (${reason}). Retrying once…`);
    result = await send();
  }

  // Sanitise logging to only output the origin (preventing path/query parameter leaks)
  let sanitizedUrl = webhookUrl;
  try {
    sanitizedUrl = new URL(webhookUrl).origin;
  } catch {
    // fallback if URL parsing fails
  }

  const isSuccess =
    result.error === undefined &&
    result.status !== undefined &&
    result.status >= 200 &&
    result.status < 300;

  if (isSuccess) {
    console.log(
      `[Orchestrator] Webhook delivered to ${sanitizedUrl} with HTTP status ${result.status}`,
    );
  } else {
    const details = result.error
      ? ((result.error as Error).message ?? String(result.error))
      : `HTTP status ${result.status}`;
    console.error(`[Orchestrator] Webhook delivery failed to ${sanitizedUrl}: ${details}`);
  }
}

async function runTask(
  task_id: string,
  task: string,
  budget: number,
  userAddress: string | null,
  webhook_url?: string,
): Promise<void> {
  const triggerWebhook = (payload: any) => {
    if (webhook_url) {
      sendWebhookWithRetry(webhook_url, payload).catch((err) => {
        console.error(`[Orchestrator] Webhook error for task ${task_id}:`, err.message);
      });
    }
  };

  let orchestratorKeypair: Keypair | null = null;
  let vaultTaskId: bigint | null = null;
  const VAULT_CONTRACT_URL = `https://stellar.expert/explorer/testnet/contract/${process.env.AGENT_VAULT_CONTRACT_ID}`;

  try {
    // 1. Fetch available agents
    let agents: AgentRecord[];
    try {
      agents = await fetchAgents();
      broadcast('agents_loaded', { task_id, count: agents.length });
    } catch (err: any) {
      const errorMsg = `Registry unavailable: ${err.message}`;
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    if (agents.length === 0) {
      const errorMsg = 'No agents registered';
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    // 1b. Score all agents and broadcast (general scoring — no specific capability filter)
    const allScored = scoreAgents(agents, [], budget / Math.max(1, agents.length));
    broadcast('agents_scored', {
      task_id,
      agents: allScored.map((s) => ({
        agent_id: s.agent.agent_id,
        name: s.agent.name,
        score: s.score,
        breakdown: s.breakdown,
        reputation_score: s.agent.reputation?.score ?? 50,
        price_per_call: s.agent.pricing.price_per_call,
      })),
    });

    // 2. Feasibility check
    let feasibility;
    try {
      feasibility = await checkFeasibility(task, agents);
      broadcast('feasibility_checked', { task_id, ...feasibility });
    } catch (err: any) {
      const errorMsg = `Feasibility check failed: ${err.message}`;
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    if (!feasibility.feasible) {
      const errorMsg = `Cannot complete task — missing capabilities: ${feasibility.missing.join(', ')}`;
      broadcast('task_infeasible', {
        task_id,
        task,
        missing: feasibility.missing,
        message: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // 3. Plan
    let plan;
    try {
      plan = await createPlan(task, agents, budget);
    } catch (err: any) {
      const errorMsg = `Planning failed: ${err.message}`;
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    // 4. Validate
    const validation = validatePlan(plan, agents, budget);
    if (!validation.valid) {
      const errorMsg = `Invalid plan: ${validation.errors.join('; ')}`;
      broadcast('task_error', {
        task_id,
        task,
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // 5. Compute per-step selection reasoning
    const stepSelections = plan.steps.map((step) => {
      const stepAgent = agents.find((a) => a.agent_id === step.agent_id);
      const neededCaps = stepAgent?.capabilities ?? [];
      const ranked = scoreAgents(agents, neededCaps, step.estimated_cost);

      const selectedEntry = ranked.find((s) => s.agent.agent_id === step.agent_id);
      const selectedScore = selectedEntry?.score ?? 0;
      const selectedRank = ranked.findIndex((s) => s.agent.agent_id === step.agent_id) + 1;

      // Top 2 alternatives (different from selected)
      const alternatives = ranked
        .filter((s) => s.agent.agent_id !== step.agent_id)
        .slice(0, 2)
        .map((s) => ({
          agent_id: s.agent.agent_id,
          name: s.agent.name,
          score: s.score,
        }));

      return {
        step_id: step.step_id,
        agent_id: step.agent_id,
        agent_name: step.agent_name,
        action: step.action,
        payment_method: step.payment_method,
        estimated_cost: step.estimated_cost,
        depends_on: step.depends_on,
        selected_score: selectedScore,
        selected_rank: selectedRank,
        total_candidates: ranked.length,
        score_breakdown: selectedEntry?.breakdown ?? null,
        alternatives,
      };
    });

    broadcast('plan_created', {
      task_id,
      steps: plan.steps.length,
      total_estimated_cost: plan.total_estimated_cost,
      reasoning: plan.reasoning,
      step_selections: stepSelections,
    });

    broadcast('plan_validated', { task_id, valid: validation.valid, errors: validation.errors });

    // 6. Await user approval (auto-approves after APPROVAL_TIMEOUT_MS)
    try {
      await waitForApproval(task_id, {
        task_id,
        task,
        reasoning: plan.reasoning,
        total_estimated_cost: plan.total_estimated_cost,
        steps: stepSelections,
        auto_approve_in_ms: APPROVAL_TIMEOUT_MS,
      });
    } catch (err: any) {
      const errorMsg = `Plan rejected: ${err.message}`;
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    // 7. Load per-user orchestrator keypair (U5) and create vault task
    if (userAddress) {
      const record = orchestratorStore.getByUser(userAddress);
      if (record) {
        orchestratorKeypair = Keypair.fromSecret(record.orchestrator_secret);
      }
    }

    // Fall back to shared wallet if no per-user orchestrator
    if (!orchestratorKeypair) {
      orchestratorKeypair = keypair;
    }

    // Create vault task — locks plan_cost (sum of step costs) on-chain
    // Requires orchestrator to be registered on-chain first (register_orchestrator tx signed by user)
    const orchRecord = userAddress ? orchestratorStore.getByUser(userAddress) : null;
    const planCost = plan.total_estimated_cost;
    if (VAULT_ACTIVE && orchestratorKeypair) {
      if (!orchRecord?.registered_on_chain) {
        broadcast('vault_skipped', {
          task_id,
          reason:
            'Orchestrator not registered on-chain — complete on-chain registration in wallet to enable vault',
        });
        console.warn(
          `[Orchestrator] Skipping vault for task ${task_id} — orchestrator not registered on-chain`,
        );
      } else {
        vaultTaskId = await vaultCreateTask(orchestratorKeypair, planCost);
      }
      if (vaultTaskId !== null) {
        broadcast('budget_locked', {
          task_id,
          contract_task_id: Number(vaultTaskId),
          budget_usdc: planCost,
          contract_id: process.env.AGENT_VAULT_CONTRACT_ID,
          explorer_url: VAULT_CONTRACT_URL,
        });
        if (userAddress) {
          activityStore.append({
            user_address: userAddress,
            event: 'budget_locked',
            task_id,
            task_description: task,
            amount_usdc: planCost,
            vault_task_id: Number(vaultTaskId),
          });
        }
      }
    }

    // Log task started
    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_started',
        task_id,
        task_description: task,
      });
    }

    // 8. Execute
    const executor = new PlanExecutor(agents, orchestratorKeypair, vaultTaskId);

    executor.on('task_started', (data) => broadcast('task_started', data));
    executor.on('step_started', (data) => broadcast('step_started', data));
    executor.on('step_complete', (data) => {
      broadcast('step_complete', data);
    });
    executor.on('step_failed', (data) => broadcast('step_failed', data));
    executor.on('budget_released', (data) => {
      broadcast('budget_released', data);
      // Log real agent payment — budget_released carries the actual amount and tx_hash
      if (userAddress && data.amount && data.amount > 0) {
        activityStore.append({
          user_address: userAddress,
          event: 'payment_released',
          task_id,
          task_description: task,
          amount_usdc: data.amount,
          agent_name: data.agent_name,
          tx_hash: data.tx_hash,
          vault_task_id: vaultTaskId !== null ? Number(vaultTaskId) : undefined,
        });
        appendVaultTx({
          user_address: userAddress,
          type: 'payment',
          amount_usdc: data.amount,
          tx_hash: data.tx_hash,
          task_id,
          agent_name: data.agent_name,
        });
      }
    });
    executor.on('task_complete', (data) => broadcast('task_complete', data));

    let result;
    try {
      result = await executor.execute(plan, task, REGISTRY_URL, task_id);
    } catch (err: any) {
      const errorMsg = `Execution failed: ${err.message}`;
      broadcast('task_error', { task_id, task, error: errorMsg });
      throw new Error(errorMsg);
    }

    // Finalise vault task — refunds unused locked amount back to user's vault balance
    if (VAULT_ACTIVE && orchestratorKeypair && vaultTaskId !== null) {
      await vaultCompleteTask(orchestratorKeypair, vaultTaskId);
      const refund = plan.total_estimated_cost - result.total_cost;
      broadcast('budget_finalized', {
        task_id,
        contract_task_id: Number(vaultTaskId),
        total_spent: result.total_cost,
        refund_usdc: Math.max(0, refund),
        explorer_url: VAULT_CONTRACT_URL,
      });
    }

    broadcast('task_result', result);
    console.log(
      `[Orchestrator] Task ${result.task_id} ${result.status} | cost: $${result.total_cost.toFixed(4)} | ${result.total_time_ms}ms`,
    );

    // Log completion
    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_completed',
        task_id,
        task_description: task,
        amount_usdc: result.total_cost,
        vault_task_id: vaultTaskId !== null ? Number(vaultTaskId) : undefined,
      });
      // Persist full result for History tab
      saveTaskResult(userAddress, task, result);
    }

    // Trigger webhook on complete/failed execution status
    if (result.status === 'failed') {
      const failedStep = result.steps.find((s) => !s.success);
      triggerWebhook({
        task_id,
        status: 'failed',
        error: failedStep?.error ?? 'Task execution failed',
        completed_at: new Date().toISOString(),
      });
    } else {
      triggerWebhook({
        task_id,
        status: result.status === 'partial' ? 'partial' : 'completed',
        result: result.final_output,
        cost_usdc: result.total_cost.toString(),
        duration_ms: result.total_time_ms,
        completed_at: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    // Try to complete the vault task even on error to unlock funds
    if (VAULT_ACTIVE && orchestratorKeypair && vaultTaskId !== null) {
      vaultCompleteTask(orchestratorKeypair, vaultTaskId).catch(() => {});
    }

    // Log failure
    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_failed',
        task_id,
        task_description: task,
      });
    }

    // Trigger webhook on early failure
    triggerWebhook({
      task_id,
      status: 'failed',
      error: err.message || 'Task failed before execution completed',
      completed_at: new Date().toISOString(),
    });
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

export { app };

const server = createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

if (!process.env.VITEST) {
  server.listen(PORT, () => {
    console.log(`[Orchestrator] Running on port ${PORT}`);
    console.log(`[Orchestrator] Wallet: ${ORCHESTRATOR_ADDRESS}`);
    console.log(`[Orchestrator] Registry: ${REGISTRY_URL}`);
    console.log(`[Orchestrator] WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`[Orchestrator] Plan approval timeout: ${APPROVAL_TIMEOUT_MS / 1000}s`);

    // Ensure the shared orchestrator wallet is funded and has a USDC trustline
    setupSharedWallet(keypair).catch(() => {});
  });
}
