import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { soloRat } from '../../src/data/encounters.ts';
import { GUARD_GAIN } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { advanceTime } from '../../src/sim/effects.ts';
import { GUARD_CAP, absorb, decayGuard, gainGuard } from '../../src/sim/guard.ts';
import { DEFAULT_RULES } from '../../src/sim/rules.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';
import { PLAYER } from '../../src/data/encounters.ts';

function opened(): CombatState {
  const started = startCombat({
    actors: soloRat(),
    catalogue: m0Catalogue(),
    deck: [cardId('strike')],
    rng: createRng(1, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

function player(state: CombatState) {
  const actor = findActor(state, PLAYER);
  if (actor === undefined) throw new Error('no player');
  return actor;
}

/** GDD §4.4 [AMD]: one point every three ticks. */
const DECAY_EVERY = DEFAULT_RULES.guardDecayEvery;

describe('Guard is time-shaped (GDD §4.4)', () => {
  it('absorbs one big hit, or protects for that many ticks — whichever ends first', () => {
    const guarded = gainGuard(player(opened()), 12);

    // One big hit: 12 Guard eats 12 of it and the rest lands on HP.
    const struck = absorb(guarded, 20);
    expect(struck.absorbed).toBe(12);
    expect(struck.actor.hp).toBe(guarded.hp - 8);

    // Or thirty-six ticks: the same 12 Guard falls off one point every three
    // (GDD §4.4 [AMD]), which is what makes putting it up worth a turn at all.
    expect(decayGuard(guarded, { from: tick(0), to: tick(36), every: DECAY_EVERY }).guard).toBe(0);
    expect(decayGuard(guarded, { from: tick(0), to: tick(15), every: DECAY_EVERY }).guard).toBe(7);
  });

  it('never stacks past the cap, and never goes negative', () => {
    const actor = player(opened());
    expect(gainGuard(gainGuard(actor, 30), 30).guard).toBe(GUARD_CAP);
    expect(
      decayGuard(gainGuard(actor, 4), { from: tick(0), to: tick(99), every: DECAY_EVERY }).guard,
    ).toBe(0);
  });

  it('is consumed before HP on every incoming hit', () => {
    const actor = gainGuard(player(opened()), 5);
    const struck = absorb(actor, 3);

    expect(struck.actor.guard).toBe(2);
    expect(struck.actor.hp).toBe(actor.hp);
  });

  it('decays on its own clock as the scheduler advances', () => {
    const state = opened();
    const guarded = { ...state, actors: state.actors.map((a) => gainGuard(a, 10)) };
    const later = advanceTime(guarded, tick(guarded.now + 9));

    // Nine ticks, three points (GDD §4.4 [AMD]).
    expect(player(later.state).guard).toBe(7);
  });

  it('decays the same whether time moves in one step or many', () => {
    // The reason decay is computed from absolute ticks: a per-call
    // `floor(elapsed / every)` would round three separate one-tick advances
    // down to nothing each time, and Guard would never fall off at all.
    const state = opened();
    const guarded = { ...state, actors: state.actors.map((a) => gainGuard(a, 10)) };

    let stepwise: CombatState = guarded;
    for (let step = 0; step < 9; step += 1) {
      stepwise = advanceTime(stepwise, tick(stepwise.now + 1)).state;
    }

    expect(player(stepwise).guard).toBe(
      player(advanceTime(guarded, tick(guarded.now + 9)).state).guard,
    );
  });
});

describe('the Guard action as defence (GDD §4.3)', () => {
  it('grants 3 Guard, which the next small hit runs into', () => {
    const waited = reduce(opened(), { kind: 'guard' });
    if (!waited.ok) throw new Error('the Guard action is always legal');

    expect(player(waited.step.state).guard).toBe(GUARD_GAIN);
    expect(waited.step.events).toContainEqual(
      expect.objectContaining({ kind: 'guard_gained', amount: GUARD_GAIN }),
    );
  });

  it('lasts long enough to meet the next blow (GDD §4.4 [AMD])', () => {
    // The change three playtests argued for. At one point per tick the action
    // granted 3 Guard that was gone in 3 ticks of a forty-tick fight, and the
    // logs recorded Guard absorbing nothing in 23 of 25, then 8 of 9 fights.
    // At one per three, it is still up when something swings.
    const guarded = reduce(opened(), { kind: 'guard' });
    if (!guarded.ok) throw new Error('the Guard action is always legal');

    const state = guarded.step.state;
    expect(player(advanceTime(state, tick(state.now + 4)).state).guard).toBeGreaterThan(0);
    // And it is still finite: it is a window, not a wall.
    expect(player(advanceTime(state, tick(state.now + 12)).state).guard).toBe(0);
  });
});
