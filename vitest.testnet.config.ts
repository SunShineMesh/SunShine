import { defineConfig } from 'vitest/config';

// Live XRPL testnet tests — opt-in via `npm run test:testnet`.
export default defineConfig({
  test: {
    include: ['tests/**/*.testnet.test.ts'],
    testTimeout: 200000,
    hookTimeout: 60000,
  },
});
