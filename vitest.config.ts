import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve NodeNext-style ".js" specifiers to their ".ts" source so services
  // written for ESM/NodeNext can be imported directly in tests.
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'services/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/dashboard/**'],
    // Headroom for slow tests under parallel load (e.g. agent-sdk parity, which
    // makes real-ish network calls during agent init, and DB integration tests).
    testTimeout: 45000,
    hookTimeout: 45000,
    // Retries absorb the occasional parallel flake (a genuinely broken test
    // still fails after retries).
    retry: 2,
  },
});
