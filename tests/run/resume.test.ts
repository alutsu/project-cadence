import { describe, expect, it } from 'vitest';
import {
  absorbEncounter,
  craft,
  NORMAL_BASE_XP,
  openSocket,
  seat,
  SIGNATURE_CARD,
  startRun,
  type RunState,
} from '../../src/run/RunState.ts';
import {
  CURRENT_SAVE_VERSION,
  fromSnapshot,
  migrate,
  toSnapshot,
  type SaveEnvelope,
} from '../../src/run/save.ts';
import { memoryStore, readEnvelope } from '../../src/platform/saveStore.ts';
import { PLAYER } from '../../src/data/encounters.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { tick } from '../../src/sim/tick.ts';

/**
 * Save and resume (GDD §16) — M2's new determinism surface.
 *
 * This is the analogue of M1's ghost-preview equivalence, and it exists for the
 * same reason: there are now two ways to arrive at a run state, and a game is
 * only honest if they agree. A run interrupted at a node boundary and resumed
 * has to be **the same run** as one that never stopped, down to the stream
 * positions — otherwise seed replay (§13) and the balance harness (§19) are
 * both measuring something that does not exist.
 *
 * Everything round-trips through **JSON**, not `structuredClone`. IndexedDB
 * uses structured clone, so JSON is the stricter invariant of the two — it is
 * what catches a Map, a Set, an `undefined`, a `NaN` or a `-0` that structured
 * clone would happily preserve into a shape that later fails to serialize.
 */

function blow(amount: number): CombatEvent {
  return { kind: 'damage_dealt', at: tick(1), source: PLAYER, target: PLAYER, amount, tag: 'Fire' };
}

/** A gem made and put somewhere, or the run unchanged if either step refuses. */
function craftAndSeat(run: RunState): RunState {
  const made = craft(run, { frame: 'WARD', tier: 1 });
  if (!made.ok) return run;

  const seated = seat(made.run, SIGNATURE_CARD, made.value);
  return seated.ok ? seated.run : made.run;
}

/** One node's worth of progress: build a little, fight, bank it. */
function playNode(run: RunState, node: number): RunState {
  let next = run;

  if (node % 2 === 0) next = craftAndSeat(next);
  if (node % 3 === 0) {
    const opened = openSocket(next, SIGNATURE_CARD);
    if (opened.ok) next = opened.run;
  }

  return absorbEncounter(next, {
    outcome: 'won',
    hp: Math.max(1, next.hp - 5),
    events: [blow(12 + node)],
    baseXp: NORMAL_BASE_XP,
  });
}

/** A run through JSON and back, exactly as a store would move it. */
function roundTrip(run: RunState): RunState {
  const envelope: SaveEnvelope = {
    version: CURRENT_SAVE_VERSION,
    savedAtMs: 0,
    run: toSnapshot(run),
  };
  const stored: unknown = JSON.parse(JSON.stringify(envelope));

  const migrated = migrate(stored);
  if (!migrated.ok) throw new Error(migrated.errors.join('; '));
  const parsed = fromSnapshot(migrated.value);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.value;
}

const NODES = 5;

describe('a resumed run is the run (GDD §16, §20.2)', () => {
  it('ends identical to one that never stopped, interrupted at every save point', () => {
    let straight = startRun(4242);
    for (let node = 0; node < NODES; node += 1) straight = playNode(straight, node);

    // Every boundary is a save point (§16: "after every node transition").
    for (let interruptAt = 0; interruptAt <= NODES; interruptAt += 1) {
      let interrupted = startRun(4242);
      for (let node = 0; node < interruptAt; node += 1) interrupted = playNode(interrupted, node);

      interrupted = roundTrip(interrupted);

      for (let node = interruptAt; node < NODES; node += 1) {
        interrupted = playNode(interrupted, node);
      }

      expect(interrupted, `interrupted after node ${String(interruptAt)}`).toEqual(straight);
    }
  });

  it('carries every stream position across the round trip', () => {
    let run = startRun(77);
    for (let node = 0; node < NODES; node += 1) run = playNode(run, node);

    expect(roundTrip(run).streams).toEqual(run.streams);
  });

  it('survives a run with gems seated and sockets scarred', () => {
    let run = startRun(9001);
    for (let node = 0; node < NODES; node += 1) run = playNode(run, node);

    const resumed = roundTrip(run);
    expect(Object.keys(resumed.build.gems)).toEqual(Object.keys(run.build.gems));
    expect(resumed.build.sockets).toEqual(run.build.sockets);
  });

  it('brings per-fight gem counters back empty, not carried', () => {
    // A charge is earned in the fight it is spent in (GDD §6.2), and an
    // encounter resumes from its start — so runtime is never written.
    const run = startRun(5);
    const resumed = roundTrip({
      ...run,
      build: { ...run.build, runtime: { anything: { charges: 9, uses: 3 } } },
    });

    for (const counters of Object.values(resumed.build.runtime)) {
      expect(counters).toEqual({ charges: 0, uses: 0 });
    }
  });
});

describe('a save that cannot be trusted is refused, never half-read (GDD §16)', () => {
  it('reports no save rather than inventing one', () => {
    expect(readEnvelope(null)).toEqual({ kind: 'none' });
    expect(readEnvelope(undefined)).toEqual({ kind: 'none' });
  });

  it('refuses a save from a newer build', () => {
    const stored = {
      version: CURRENT_SAVE_VERSION + 1,
      savedAtMs: 0,
      run: toSnapshot(startRun(1)),
    };
    const result = readEnvelope(stored);

    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' ? result.reason : '').toContain('newer build');
  });

  it('refuses a version with no migration path', () => {
    // The chain is empty today (§16 wants it decided before the first public
    // build), so a v0 has nowhere to come from — and says so.
    const stored = { version: 0, savedAtMs: 0, run: toSnapshot(startRun(1)) };
    const result = readEnvelope(stored);

    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' ? result.reason : '').toContain('no migration from version 0');
  });

  it('refuses a deck naming a card this build no longer has', () => {
    const snapshot = toSnapshot(startRun(1));
    const stored = {
      version: CURRENT_SAVE_VERSION,
      savedAtMs: 0,
      run: { ...snapshot, deck: [...snapshot.deck, 'a_card_from_another_game'] },
    };

    const result = readEnvelope(stored);
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' ? result.reason : '').toContain('does not have');
  });

  it('refuses a save whose stream list is not this build’s', () => {
    const snapshot = toSnapshot(startRun(1));
    const { weave: dropped, ...missing } = snapshot.streams;
    void dropped;

    const stored = {
      version: CURRENT_SAVE_VERSION,
      savedAtMs: 0,
      run: { ...snapshot, streams: missing },
    };

    expect(readEnvelope(stored).kind).toBe('invalid');
  });

  it('refuses a gem naming an effect that no longer exists', () => {
    const snapshot = toSnapshot(startRun(1));
    const stored = {
      version: CURRENT_SAVE_VERSION,
      savedAtMs: 0,
      run: {
        ...snapshot,
        gems: [
          {
            id: 'g_ghost',
            frame: 'REPEAT',
            tier: 1,
            words: [],
            weightDelta: 0,
            effects: [{ type: 'ASCEND_TO_GODHOOD', value: 1, tag: null }],
            affixes: [],
          },
        ],
      },
    };

    expect(readEnvelope(stored).kind).toBe('invalid');
  });
});

describe('the store keeps its contract without a browser', () => {
  it('round-trips a run through the memory store', async () => {
    let run = startRun(31);
    for (let node = 0; node < NODES; node += 1) run = playNode(run, node);

    const store = memoryStore();
    expect((await store.load()).kind).toBe('none');

    await store.save(run);
    const loaded = await store.load();

    expect(loaded.kind).toBe('resumed');
    expect(loaded.kind === 'resumed' ? loaded.run : null).toEqual(run);
  });

  it('forgets a run when it is cleared — a dead run must not resume (§13)', async () => {
    const store = memoryStore();
    await store.save(startRun(2));
    await store.clear();

    expect((await store.load()).kind).toBe('none');
  });
});
