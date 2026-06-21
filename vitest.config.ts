import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.tsx'],
    exclude: ['tests/**/*.testnet.test.ts', 'node_modules/**'],
    testTimeout: 20000,
    env: {
      // Keep the World ID nullifier store in-memory during test runs so that
      // test state never accumulates in a real file, files stay clean across
      // parallel CI shards, and the data/ directory is not polluted.
      WORLDID_NULLIFIER_STORE: ':memory:',
      // Always use the small JSON fixture for AML during tests so results are
      // deterministic, fast, and offline-safe (never depends on the multi-MB CSV).
      SANCTIONS_FIXTURE: 'true',
    },
  },
});
