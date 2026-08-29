import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'esnext',
    // Phaser is ~1.4 MB minified and ships as one vendor chunk. Splitting it buys
    // nothing for a single-page game that needs the whole engine on first frame.
    chunkSizeWarningLimit: 2000,
  },
});
