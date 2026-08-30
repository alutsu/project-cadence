import { defineConfig } from 'vite';

export default defineConfig({
  /**
   * Relative, so the build runs from any path. GitHub Pages serves a project
   * site from /<repo>/ rather than the root, and hardcoding that would tie the
   * bundle to the repository's current name. Nothing here routes, so relative
   * asset URLs are enough.
   */
  base: './',
  server: { port: 5173 },
  build: {
    target: 'esnext',
    // Phaser is ~1.4 MB minified and ships as one vendor chunk. Splitting it buys
    // nothing for a single-page game that needs the whole engine on first frame.
    chunkSizeWarningLimit: 2000,
  },
});
