import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Where a playtest session is written. Git-ignored; it is one machine's notes. */
const PLAYTEST_DIR = 'playtest';
const ENDPOINT = '/__playtest';
const MAX_BODY_BYTES = 1_000_000;

/**
 * Writes playtest telemetry to disk while the game is being played (GDD §19).
 *
 * **Dev server only** — it is a middleware, so it exists in `vite dev` and in
 * no build output at all. That is the whole reason the recorder posts to an
 * endpoint rather than triggering a download: the log lands next to the source
 * without the player having to do anything, and a shipped bundle has nowhere to
 * post to.
 *
 * Appends NDJSON, one event per line, so a session can be read while it is
 * still being written and a crashed run still leaves everything up to the
 * crash. The file is named for the session so two tabs cannot interleave.
 */
function playtestRecorder(): Plugin {
  return {
    name: 'cadence-playtest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        request.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          // A runaway page must not be able to fill the disk.
          if (body.length > MAX_BODY_BYTES) request.destroy();
        });
        request.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(body);
            writeSession(parsed);
            response.statusCode = 204;
          } catch {
            response.statusCode = 400;
          }
          response.end();
        });
      });
    },
  };
}

interface Batch {
  readonly session: string;
  readonly events: readonly unknown[];
}

function isBatch(value: unknown): value is Batch {
  if (typeof value !== 'object' || value === null) return false;

  const candidate: Record<string, unknown> = { ...value };
  return typeof candidate.session === 'string' && Array.isArray(candidate.events);
}

function writeSession(parsed: unknown): void {
  if (!isBatch(parsed)) return;

  // Only ever a file name, never a path: the session id comes from the page.
  const name = parsed.session.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (name.length === 0) return;

  mkdirSync(PLAYTEST_DIR, { recursive: true });
  const lines = parsed.events.map((event) => JSON.stringify(event)).join('\n');
  appendFileSync(join(PLAYTEST_DIR, `${name}.ndjson`), `${lines}\n`, 'utf8');
}

export default defineConfig({
  plugins: [playtestRecorder()],
  /**
   * Relative, so the build runs from any path. GitHub Pages serves a project
   * site from /<repo>/ rather than the root, and hardcoding that would tie the
   * bundle to the repository's current name. Nothing here routes, so relative
   * asset URLs are enough.
   */
  base: './',
  server: { port: 8081 },
  build: {
    target: 'esnext',
    // Phaser is ~1.4 MB minified and ships as one vendor chunk. Splitting it buys
    // nothing for a single-page game that needs the whole engine on first frame.
    chunkSizeWarningLimit: 2000,
  },
});
