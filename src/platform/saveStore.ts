import { fromSnapshot, migrate, toSnapshot, CURRENT_SAVE_VERSION } from '../run/save.ts';
import type { SaveEnvelope } from '../run/save.ts';
import type { RunState } from '../run/RunState.ts';

/**
 * Where the save actually goes (GDD §16).
 *
 * This is the only module that knows a database exists, and the only one in the
 * project outside `/scenes` and `/ui` that is asynchronous or browser-only.
 * `/run/save.ts` turns a run into plain data; this puts the data somewhere. The
 * split is what lets every save test run headlessly, and an architecture guard
 * enforces it rather than leaving it to memory.
 */

export type LoadResult =
  | { readonly kind: 'resumed'; readonly run: RunState }
  | { readonly kind: 'none' }
  /** Stated, not swallowed. §16 allows invalidation but never a partial load. */
  | { readonly kind: 'invalid'; readonly reason: string };

export interface SaveStore {
  load(): Promise<LoadResult>;
  save(run: RunState): Promise<void>;
  clear(): Promise<void>;
}

const DATABASE = 'cadence';
const STORE = 'run';
const SLOT = 'current';

function envelopeOf(run: RunState, savedAtMs: number): SaveEnvelope {
  return { version: CURRENT_SAVE_VERSION, savedAtMs, run: toSnapshot(run) };
}

/** A stored envelope, back into a run — or the reason it will not be. */
export function readEnvelope(stored: unknown): LoadResult {
  if (stored === undefined || stored === null) return { kind: 'none' };

  const migrated = migrate(stored);
  if (!migrated.ok) return { kind: 'invalid', reason: migrated.errors.join('; ') };

  const parsed = fromSnapshot(migrated.value);
  return parsed.ok
    ? { kind: 'resumed', run: parsed.value }
    : { kind: 'invalid', reason: parsed.errors.join('; ') };
}

/**
 * The store the tests and the harness use. Same contract, no database — which
 * is the point: nothing about saving should require a browser to verify.
 */
export function memoryStore(): SaveStore {
  let held: unknown = null;

  return {
    load: (): Promise<LoadResult> => Promise.resolve(readEnvelope(held)),
    save: (run: RunState): Promise<void> => {
      // Round-tripped through JSON deliberately, so the in-memory store cannot
      // pass something a real one would reject — a Map, an undefined, a NaN.
      held = JSON.parse(JSON.stringify(envelopeOf(run, 0)));
      return Promise.resolve();
    },
    clear: (): Promise<void> => {
      held = null;
      return Promise.resolve();
    },
  };
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(new Error(`could not open the save database: ${String(request.error?.message)}`));
    };
  });
}

function transact<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = act(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(new Error(`save store failed: ${String(request.error?.message)}`));
    };
  });
}

/**
 * IndexedDB, browser-only.
 *
 * Writes are chained rather than concurrent: §16 saves at every node boundary,
 * and a player clicking quickly could otherwise interleave two writes and leave
 * the later one behind the earlier. Latest wins, in order.
 */
export function indexedDbStore(name: string = DATABASE): SaveStore {
  let pending: Promise<unknown> = Promise.resolve();

  const queue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = pending.then(work, work);
    pending = next.catch(() => undefined);
    return next;
  };

  return {
    load: (): Promise<LoadResult> =>
      queue(async () => {
        const database = await openDatabase(name);
        const stored: unknown = await transact(database, 'readonly', (store) => store.get(SLOT));
        database.close();
        return readEnvelope(stored);
      }),
    save: (run: RunState): Promise<void> =>
      queue(async () => {
        const database = await openDatabase(name);
        await transact(database, 'readwrite', (store) =>
          store.put(envelopeOf(run, Date.now()), SLOT),
        );
        database.close();
      }),
    clear: (): Promise<void> =>
      queue(async () => {
        const database = await openDatabase(name);
        await transact(database, 'readwrite', (store) => store.delete(SLOT));
        database.close();
      }),
  };
}
