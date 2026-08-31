import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { RAT, WARDEN, ratAndWarden } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { FIRST_STAGGER, MIN_STAGGER, breaksPoise, staggerDelay } from '../../src/sim/poise.ts';
import { createRng } from '../../src/sim/rng.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';

const CATALOGUE = m0Catalogue();

function opened(deck: readonly CardId[]): CombatState {
  const started = startCombat({
    actors: ratAndWarden(),
    catalogue: CATALOGUE,
    deck,
    rng: createRng(1, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

function actor(state: CombatState, id: typeof RAT) {
  const found = findActor(state, id);
  if (found === undefined) throw new Error('missing actor');
  return found;
}

describe('Poise is a threshold, not a pool (GDD §4.6 [AMD])', () => {
  it('staggers on one hit at or above the threshold', () => {
    const state = opened([cardId('lunge')]);
    const played = reduce(state, { kind: 'play', card: cardId('lunge'), target: RAT });
    if (!played.ok) throw new Error('strike should be legal');

    // Strike deals 9; the rat's threshold is 8.
    expect(played.step.events).toContainEqual(
      expect.objectContaining({ kind: 'staggered', actor: RAT, delay: FIRST_STAGGER }),
    );
  });

  it('never staggers on chip damage, however much of it lands', () => {
    const state = opened([cardId('sweep'), cardId('sweep'), cardId('sweep')]);

    // Sweep deals 6 to each into a threshold of 8. Three still never break it —
    // that is the whole difference between a threshold and a pool.
    let current = state;
    for (let hit = 0; hit < 3; hit += 1) {
      const played = reduce(current, { kind: 'play', card: cardId('sweep'), target: RAT });
      if (!played.ok) break;
      expect(played.step.events.some((event) => event.kind === 'staggered')).toBe(false);
      current = advanceToDecision(played.step.state).state;
    }

    expect(actor(current, RAT).staggersTaken).toBe(0);
  });

  it('leaves the Warden standing under anything but the heaviest cards', () => {
    const state = opened([cardId('hammerfall'), cardId('crush')]);

    // Hammerfall deals 16 into the Warden's threshold of 22: no stagger.
    const light = reduce(state, { kind: 'play', card: cardId('hammerfall'), target: WARDEN });
    if (!light.ok) throw new Error('hammerfall should be legal');
    expect(light.step.events.some((event) => event.kind === 'staggered')).toBe(false);

    // Crush deals 24 and interrupts the swing.
    const heavy = reduce(advanceToDecision(light.step.state).state, {
      kind: 'play',
      card: cardId('crush'),
      target: WARDEN,
    });
    if (!heavy.ok) throw new Error('crush should be legal');
    expect(heavy.step.events).toContainEqual(
      expect.objectContaining({ kind: 'staggered', actor: WARDEN }),
    );
  });
});

function staggerDelays(events: readonly CombatEvent[]): number[] {
  return events.filter((event) => event.kind === 'staggered').map((event) => event.delay);
}

describe('the diminishing ladder (GDD §4.6 [FIX])', () => {
  it('halves each time, with a floor of one', () => {
    expect(staggerDelay(0)).toBe(3);
    expect(staggerDelay(1)).toBe(2);
    expect(staggerDelay(2)).toBe(1);
    expect(staggerDelay(3)).toBe(MIN_STAGGER);
    expect(staggerDelay(99)).toBe(MIN_STAGGER);
  });

  it('walks a real enemy down the ladder, so a Break build cannot lock it out', () => {
    const opening = opened(Array.from({ length: 6 }, () => cardId('lunge')));
    // A rat that survives four hits, so the ladder is what ends the sequence
    // rather than the corpse.
    let state: CombatState = {
      ...opening,
      actors: opening.actors.map((a) => (a.id === RAT ? { ...a, hp: 200, maxHp: 200 } : a)),
    };
    const delays: number[] = [];

    for (let hit = 0; hit < 4; hit += 1) {
      const played = reduce(state, { kind: 'play', card: cardId('lunge'), target: RAT });
      if (!played.ok) break;
      delays.push(...staggerDelays(played.step.events));
      state = advanceToDecision(played.step.state).state;
      if (state.outcome !== 'ongoing') break;
    }

    expect(delays).toEqual([3, 2, 1, 1]);
  });

  it('applies Brittle by lowering the threshold, never below one', () => {
    const state = opened([cardId('sweep')]);
    const brittle = {
      ...actor(state, RAT),
      statuses: [{ kind: 'brittle' as const, magnitude: 4, expiresAt: tick(50), nextProcAt: null }],
    };

    // Threshold 8 minus Brittle 4 is 4, so Sweep's 6 now breaks it.
    expect(breaksPoise(actor(state, RAT), 6)).toBe(false);
    expect(breaksPoise(brittle, 6)).toBe(true);
  });
});
