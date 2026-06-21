import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.testnet.test.ts', 'node_modules/**'],
    testTimeout: 20000,
  },
});
