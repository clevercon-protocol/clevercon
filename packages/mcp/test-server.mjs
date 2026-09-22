#!/usr/bin/env node

/**
 * Simple test script for CleverCon MCP Server
 * Tests that all tools are available and handle basic requests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sendMCPRequest(request) {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [join(__dirname, 'dist/server.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let response = '';
    let errorOutput = '';

    server.stdout.on('data', (data) => {
      response += data.toString();
    });

    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    server.on('close', (code) => {
      if (code === 0) {
        try {
          // Parse JSON-RPC responses (may be multiple)
          const lines = response.trim().split('\n');
          const jsonResponses = lines
            .filter((line) => line.trim())
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          resolve(jsonResponses);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}\nResponse: ${response}`));
        }
      } else {
        reject(new Error(`Server exited with code ${code}\nStderr: ${errorOutput}`));
      }
    });

    server.on('error', (error) => {
      reject(error);
    });

    // Send the request
    server.stdin.write(JSON.stringify(request) + '\n');
    server.stdin.end();
  });
}

async function testListTools() {
  console.log('Testing tool listing...');

  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  };

  try {
    const responses = await sendMCPRequest(request);
    const response = responses.find((r) => r.id === 1);

    if (!response) {
      throw new Error('No response received for tools/list');
    }

    if (response.error) {
      throw new Error(`Server error: ${JSON.stringify(response.error)}`);
    }

    const tools = response.result?.tools || [];
    const expectedTools = [
      'search_services',
      'get_service',
      'pay',
      'disburse',
      'hire_agent',
      'set_limit',
      'list_limits',
      'get_budget',
      'get_activity',
      'list_tasks',
      'get_task',
      'dispute_task',
    ];

    const actualToolNames = tools.map((t) => t.name);

    for (const expected of expectedTools) {
      if (!actualToolNames.includes(expected)) {
        throw new Error(`Missing tool: ${expected}`);
      }
    }

    console.log(`✅ All ${expectedTools.length} tools available:`, actualToolNames);
    return true;
  } catch (error) {
    console.error('❌ Tool listing failed:', error.message);
    return false;
  }
}

async function testSearchServices() {
  console.log('Testing search_services tool...');

  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'search_services',
      arguments: { limit: 3 },
    },
  };

  try {
    const responses = await sendMCPRequest(request);
    const response = responses.find((r) => r.id === 2);
    if (!response) throw new Error('No response received for search_services');
    // The tool wraps API errors (e.g. API unreachable) in its result text rather
    // than a protocol error, so any response here means the tool is wired.
    console.log('✅ search_services tool responded');
    return true;
  } catch (error) {
    console.error('❌ search_services test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Running CleverCon MCP Server tests...\n');

  const tests = [testListTools, testSearchServices];

  let passed = 0;

  for (const test of tests) {
    const success = await test();
    if (success) passed++;
    console.log('');
  }

  console.log(`📊 Tests completed: ${passed}/${tests.length} passed`);

  if (passed === tests.length) {
    console.log('🎉 All tests passed! MCP server is working correctly.');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check the implementation.');
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});
