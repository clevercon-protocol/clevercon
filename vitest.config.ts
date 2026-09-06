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
    // Integration tests may need more time to reach a real database.
    testTimeout: 20000,
    // One retry to absorb the occasional slow/parallel flake (a genuinely broken
    // test still fails on the retry).
    retry: 1,
  },
});
