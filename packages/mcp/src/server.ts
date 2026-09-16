#!/usr/bin/env node

/**
 * CleverCon MCP Server
 *
 * Gives an AI agent a bounded, non-custodial Stellar spending account on
 * CleverCon: discover services, pay/disburse/hire within a policy, set spending
 * limits, and read budget + activity. Every action is driven with a scoped API
 * key and bounded on-chain by the vault, so the agent can spend but never
 * overspend or pay outside the rules, and never holds funds.
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

import { searchServicesHandler, searchServicesSchema } from './tools/discovery.js';
import { getServiceHandler, getServiceSchema } from './tools/discovery.js';
import { hireAgentHandler, hireAgentSchema } from './tools/hire-agent.js';
import { listTasksHandler, listTasksSchema } from './tools/list-tasks.js';
import { getTaskHandler, getTaskSchema } from './tools/get-task.js';
import { disputeTaskHandler, disputeTaskSchema } from './tools/dispute-task.js';
import {
  payHandler,
  paySchema,
  disburseHandler,
  disburseSchema,
  setLimitHandler,
  setLimitSchema,
  listLimitsHandler,
  listLimitsSchema,
  getBudgetHandler,
  getBudgetSchema,
  getActivityHandler,
  getActivitySchema,
} from './tools/money.js';
import type { ApiConfig } from './api-client.js';

function getConfig(): ApiConfig {
  return {
    api_url: process.env.CLEVERCON_API_URL || 'http://localhost:4100',
    api_key: process.env.CLEVERCON_API_KEY,
  };
}

class CleverConMCPServer {
  private server: Server;
  private config: ApiConfig;

  constructor() {
    this.config = getConfig();
    this.server = new Server(
      { name: 'clevercon-mcp-server', version: '2.0.0' },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // discovery
        searchServicesSchema,
        getServiceSchema,
        // spend
        paySchema,
        disburseSchema,
        hireAgentSchema,
        // limits
        setLimitSchema,
        listLimitsSchema,
        // state
        getBudgetSchema,
        getActivitySchema,
        listTasksSchema,
        getTaskSchema,
        disputeTaskSchema,
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        switch (name) {
          case 'search_services':
            return await searchServicesHandler(args || {}, this.config);
          case 'get_service':
            return await getServiceHandler(args || {}, this.config);
          case 'pay':
            return await payHandler(args || {}, this.config);
          case 'disburse':
            return await disburseHandler(args || {}, this.config);
          case 'hire_agent':
            return await hireAgentHandler(args || {}, this.config);
          case 'set_limit':
            return await setLimitHandler(args || {}, this.config);
          case 'list_limits':
            return await listLimitsHandler(args || {}, this.config);
          case 'get_budget':
            return await getBudgetHandler(args || {}, this.config);
          case 'get_activity':
            return await getActivityHandler(args || {}, this.config);
          case 'list_tasks':
            return await listTasksHandler(args || {}, this.config);
          case 'get_task':
            return await getTaskHandler(args || {}, this.config);
          case 'dispute_task':
            return await disputeTaskHandler(args || {}, this.config);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
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

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = new CleverConMCPServer();
  server.run().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { CleverConMCPServer };
