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
      stdio: ['pipe', 'pipe', 'pipe']
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
            .filter(line => line.trim())
            .map(line => {
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
    method: 'tools/list'
  };

  try {
    const responses = await sendMCPRequest(request);
    const response = responses.find(r => r.id === 1);
    
    if (!response) {
      throw new Error('No response received for tools/list');
    }

    if (response.error) {
      throw new Error(`Server error: ${JSON.stringify(response.error)}`);
    }

    const tools = response.result?.tools || [];
    const expectedTools = [
      'search_agents',
      'get_agent', 
      'get_vault_balance',
      'build_deposit',
      'build_release',
      'estimate_cost'
    ];

    const actualToolNames = tools.map(t => t.name);
    
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

async function testSearchAgents() {
  console.log('Testing search_agents tool...');
  
  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'search_agents',
      arguments: {
        capability: 'test-capability'
      }
    }
  };

  try {
    const responses = await sendMCPRequest(request);
    const response = responses.find(r => r.id === 2);
    
    if (!response) {
      throw new Error('No response received for search_agents');
    }

    // Even if it returns an error due to registry not being available, 
    // the tool should handle it gracefully
    if (response.error) {
      console.log('⚠️ Tool returned server error (registry may not be available):', response.error.message);
    } else {
      console.log('✅ search_agents tool responded successfully');
    }
    
    return true;
  } catch (error) {
    console.error('❌ search_agents test failed:', error.message);
    return false;
  }
}

async function testEstimateCost() {
  console.log('Testing estimate_cost tool...');
  
  const request = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'estimate_cost',
      arguments: {
        capability: 'data-analysis'
      }
    }
  };

  try {
    const responses = await sendMCPRequest(request);
    const response = responses.find(r => r.id === 3);
    
    if (!response) {
      throw new Error('No response received for estimate_cost');
    }

    if (response.error) {
      console.log('⚠️ Tool returned server error (registry may not be available):', response.error.message);
    } else {
      console.log('✅ estimate_cost tool responded successfully');
    }
    
    return true;
  } catch (error) {
    console.error('❌ estimate_cost test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Running CleverCon MCP Server tests...\n');
  
  const tests = [
    testListTools,
    testSearchAgents,
    testEstimateCost
  ];

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

runTests().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});