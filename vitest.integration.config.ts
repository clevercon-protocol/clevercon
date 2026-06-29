import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/__tests__/vault-client.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
