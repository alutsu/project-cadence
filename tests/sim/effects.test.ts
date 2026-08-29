import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, soloRat } from '../../src/data/encounters.ts';
import { advanceToDecision, applyStatus, startCombat } from '../../src/sim/combat.ts';
import { advanceTime } from '../../src/sim/effects.ts';
import { gainGuard } from '../../src/sim/guard.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { actorSpeed } from '../../src/sim/actor.ts';
import { BURN_DURATION, POISON_INTERVAL, type Status } from '../../src/sim/status.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { tick, type Tick } from '../../src/sim/tick.ts';

function opened(playerSpeed = 100): CombatState {
  const [player, rat] = soloRat();
  if (player === undefined || rat === undefined) throw new Error('bad encounter');

  const started = startCombat({
    actors: [{ ...player, baseSpeed: playerSpeed }, rat],
    catalogue: m0Catalogue(),
    deck: [cardId('strike')],
    rng: createRng(1, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

function poison(magnitude: number, from: Tick): Status {
  return {
    kind: 'poison',
    magnitude,
    expiresAt: null,
    nextProcAt: tick(from + POISON_INTERVAL),
  };
}

function hpOf(state: CombatState): number {
  const actor = findActor(state, PLAYER);
  if (actor === undefined) throw new Error('no player');
  return actor.hp;
}

describe('Poison (GDD §4.5)', () => {
  it('ticks every five ticks and loses one magnitude per proc', () => {
    const state = opened();
    const applied = applyStatus(state, PLAYER, poison(4, state.now));
    const before = hpOf(applied.state);

    // Four procs over twenty ticks: 4 + 3 + 2 + 1 = 10 damage, then it is spent.
    const later = advanceTime(applied.state, tick(state.now + 20));

    expect(before - hpOf(later.state)).toBe(10);
    expect(findActor(later.state, PLAYER)?.statuses).toEqual([]);
  });

  it('ignores Guard — mitigation does not answer poison', () => {
    const state = opened();
    const guarded = {
      ...state,
      actors: state.actors.map((actor) => (actor.id === PLAYER ? gainGuard(actor, 30) : actor)),
    };
    const applied = applyStatus(guarded, PLAYER, poison(3, guarded.now));
    const later = advanceTime(applied.state, tick(guarded.now + 5));

    expect(hpOf(later.state)).toBe(hpOf(guarded) - 3);
  });

  /** The clarification the GDD makes explicitly: fast builds are not punished twice. */
  it('runs on its own clock, not the victim’s Speed', () => {
    const slowRun = opened(100);
    const fastRun = opened(160);
    const fastPlayer = findActor(fastRun, PLAYER);
    if (fastPlayer === undefined) throw new Error('no player');
    expect(actorSpeed(fastPlayer)).toBeGreaterThan(100);

    const slowPoisoned = applyStatus(slowRun, PLAYER, poison(5, slowRun.now)).state;
    const fastPoisoned = applyStatus(fastRun, PLAYER, poison(5, fastRun.now)).state;

    const slowLater = advanceTime(slowPoisoned, tick(slowPoisoned.now + 20));
    const fastLater = advanceTime(fastPoisoned, tick(fastPoisoned.now + 20));

    expect(hpOf(slowPoisoned) - hpOf(slowLater.state)).toBe(14);
    expect(hpOf(fastPoisoned) - hpOf(fastLater.state)).toBe(14);
  });
});

describe('Burn and Bleed (GDD §4.5)', () => {
  it('burns for a flat amount and expires on its own duration', () => {
    const state = opened();
    const burn: Status = {
      kind: 'burn',
      magnitude: 3,
      expiresAt: tick(state.now + BURN_DURATION),
      nextProcAt: tick(state.now + 5),
    };
    const applied = applyStatus(state, PLAYER, burn);
    const later = advanceTime(applied.state, tick(state.now + BURN_DURATION));

    // Four procs at a flat 3, and gone at twenty ticks — no decay (unlike Poison).
    expect(hpOf(applied.state) - hpOf(later.state)).toBe(12);
    expect(findActor(later.state, PLAYER)?.statuses).toEqual([]);
  });

  it('leaves Bleed alone until the afflicted actor acts', () => {
    const state = opened();
    const bleed: Status = {
      kind: 'bleed',
      magnitude: 4,
      expiresAt: tick(state.now + 30),
      nextProcAt: null,
    };
    const applied = applyStatus(state, PLAYER, bleed);
    const later = advanceTime(applied.state, tick(state.now + 20));

    expect(hpOf(later.state)).toBe(hpOf(applied.state));
  });
});

describe('Slow and Haste (GDD §4.5, §4.7)', () => {
  it('move effective Speed, and therefore the queue', () => {
    const state = opened();
    const slowed = applyStatus(state, PLAYER, {
      kind: 'slow',
      magnitude: 30,
      expiresAt: tick(state.now + 20),
      nextProcAt: null,
    });

    const before = findActor(state, PLAYER);
    const after = findActor(slowed.state, PLAYER);
    if (before === undefined || after === undefined) throw new Error('no player');

    expect(actorSpeed(before)).toBe(100);
    expect(actorSpeed(after)).toBe(70);
  });

  it('expires on the timeline, restoring the actor’s own Speed', () => {
    const state = opened();
    const slowed = applyStatus(state, PLAYER, {
      kind: 'slow',
      magnitude: 30,
      expiresAt: tick(state.now + 10),
      nextProcAt: null,
    });
    const later = advanceTime(slowed.state, tick(state.now + 10));
    const actor = findActor(later.state, PLAYER);
    if (actor === undefined) throw new Error('no player');

    expect(actorSpeed(actor)).toBe(100);
  });
});
