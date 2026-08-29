#!/usr/bin/env node

/**
 * CleverCon MCP Server
 * 
 * Exposes CleverCon's agent discovery, vault views, and payment helpers
 * as MCP tools for AI agents and other MCP-compatible clients.
 * 
 * The server is keyless by design - payment tools return unsigned XDR
 * that must be signed by the client's wallet.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

// Import tools
import { searchAgentsHandler, searchAgentsSchema } from './tools/search-agents.js';
import { getAgentHandler, getAgentSchema } from './tools/get-agent.js';
import { getVaultBalanceHandler, getVaultBalanceSchema } from './tools/get-vault-balance.js';
import { buildDepositHandler, buildDepositSchema } from './tools/build-deposit.js';
import { buildReleaseHandler, buildReleaseSchema } from './tools/build-release.js';
import { estimateCostHandler, estimateCostSchema } from './tools/estimate-cost.js';

interface ServerConfig {
  registry_url: string;
  soroban_rpc_url: string;
  network_passphrase: string;
  vault_contract_id: string;
  usdc_sac: string;
}

function getConfig(): ServerConfig {
  return {
    registry_url: process.env.REGISTRY_URL || 'http://localhost:3001',
    soroban_rpc_url: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    network_passphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
    vault_contract_id: process.env.AGENT_VAULT_CONTRACT_ID || '',
    usdc_sac: process.env.USDC_SAC || '',
  };
}

class CleverConMCPServer {
  private server: Server;
  private config: ServerConfig;

  constructor() {
    this.config = getConfig();
    this.server = new Server(
      {
        name: 'clevercon-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        searchAgentsSchema,
        getAgentSchema,
        getVaultBalanceSchema,
        buildDepositSchema,
        buildReleaseSchema,
        estimateCostSchema,
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'search_agents':
            return await searchAgentsHandler(args || {}, this.config);
            
          case 'get_agent':
            return await getAgentHandler(args || {}, this.config);
            
          case 'get_vault_balance':
            return await getVaultBalanceHandler(args || {}, this.config);
            
          case 'build_deposit':
            return await buildDepositHandler(args || {}, this.config);
            
          case 'build_release':
            return await buildReleaseHandler(args || {}, this.config);
            
          case 'estimate_cost':
            return await estimateCostHandler(args || {}, this.config);
            
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('CleverCon MCP Server running on stdio');
  }
}

// Start the server
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = new CleverConMCPServer();
  server.run().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { CleverConMCPServer };