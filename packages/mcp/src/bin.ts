#!/usr/bin/env node

/**
 * CLI entry for the CleverCon MCP server. This file ALWAYS runs the server when
 * executed, so it works through a package-manager bin shim (npx, npm -g, pnpm/yarn
 * dlx), where the launcher resolves argv[1] to the symlink path while ESM resolves
 * import.meta.url to the real file. A main-module guard here would be false through
 * that symlink and the server would silently never start, so there is no guard: the
 * class lives in server.js (the library entry) and this is the executable.
 */

import { CleverConMCPServer } from './server.js';

new CleverConMCPServer().run().catch((error) => {
  console.error('CleverCon MCP Server failed to start:', error);
  process.exit(1);
});
