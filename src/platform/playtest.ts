import type { PlaytestEvent } from '../run/telemetry.ts';

/**
 * Shipping a playtest log off the page (GDD §19).
 *
 * `/run/telemetry.ts` decides *what* is worth recording; this decides where it
 * goes, because posting anything is asynchronous and browser-only and neither
 * `/run` nor `/sim` is allowed to be. The architecture guards enforce that.
 *
 * **Development only.** The endpoint below exists solely in the Vite dev
 * server, so a production build has nothing to post to and the sink turns
 * itself off. §19's telemetry proper is "opt-in, anonymous, and disclosed
 * in-game"; this is not that. It is the developer's own machine writing to the
 * developer's own disk while they play, and it ships nowhere.
 */

export const PLAYTEST_ENDPOINT = '/__playtest';

export interface PlaytestLog {
  record(event: PlaytestEvent): void;
  /** Pushes anything still buffered. Called when a run ends. */
  flush(): void;
}

/** Production, and anywhere the endpoint is absent. Records nothing. */
export function silentLog(): PlaytestLog {
  return { record: (): void => undefined, flush: (): void => undefined };
}

const FLUSH_AFTER_MS = 1500;
const MAX_BUFFERED = 40;

/**
 * Batched, and deliberately unreliable in one direction: if the endpoint is
 * gone the buffer is dropped rather than retried. A playtest log that stalled
 * the game to retry a POST would be changing the thing it is measuring.
 */
export function devLog(session: string): PlaytestLog {
  let buffered: PlaytestEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const send = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffered.length === 0) return;

    const body = JSON.stringify({ session, events: buffered });
    buffered = [];
    void fetch(PLAYTEST_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  };

  return {
    record: (event: PlaytestEvent): void => {
      buffered.push(event);
      if (buffered.length >= MAX_BUFFERED) {
        send();
        return;
      }
      timer ??= setTimeout(send, FLUSH_AFTER_MS);
    },
    flush: send,
  };
}

/**
 * The log for this session, or a silent one outside development.
 *
 * `import.meta.env.DEV` is replaced at build time, so the production bundle
 * contains the silent branch and nothing else — the fetch, the endpoint and the
 * buffer are all dropped by the bundler rather than merely unused.
 */
export function playtestLog(session: string): PlaytestLog {
  return import.meta.env.DEV ? devLog(session) : silentLog();
}
