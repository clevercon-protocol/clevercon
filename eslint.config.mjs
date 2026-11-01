import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/web/**',
      'packages/mcp/test-server.mjs',
      'scripts/build-test-proof.mjs',
      'scripts/zk/**',
      'data/**',
      'logs/**',
      '.local/**',
      'contracts/**/target/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The API runs compiled with plain Node (node dist/src/main.js), which cannot
    // load a `.ts` file. @clevercon/common ships as raw TS source, so a VALUE import
    // of it would resolve to src/index.ts at boot and crash (ERR_UNKNOWN_FILE_
    // EXTENSION). Only type imports (erased at compile) are allowed in the API.
    files: ['services/api/src/**/*.ts'],
    // Tests run via vitest (which transpiles TS), so a runtime common import is
    // fine there; only the compiled boot path has the constraint.
    ignores: ['services/api/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clevercon/common',
              allowTypeImports: true,
              message:
                'The compiled API cannot load @clevercon/common (TS source) at runtime. Import only types from it, or add an API-local copy (see tasks/schema-check.ts).',
            },
          ],
          patterns: [
            {
              group: ['@clevercon/common/*'],
              allowTypeImports: true,
              message:
                'The compiled API cannot load @clevercon/common (TS source) at runtime. Import only types from it, or add an API-local copy.',
            },
          ],
        },
      ],
    },
  },
);
