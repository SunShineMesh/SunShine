import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy API + SSE to the treasury server so the console talks to live XRPL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
