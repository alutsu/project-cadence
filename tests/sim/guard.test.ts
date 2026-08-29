import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { soloRat } from '../../src/data/encounters.ts';
import { WAIT_GUARD } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { advanceTime } from '../../src/sim/effects.ts';
import { GUARD_CAP, absorb, decayGuard, gainGuard } from '../../src/sim/guard.ts';
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

describe('Guard is time-shaped (GDD §4.4)', () => {
  it('absorbs one big hit, or protects for that many ticks — whichever ends first', () => {
    const guarded = gainGuard(player(opened()), 12);

    // One big hit: 12 Guard eats 12 of it and the rest lands on HP.
    const struck = absorb(guarded, 20);
    expect(struck.absorbed).toBe(12);
    expect(struck.actor.hp).toBe(guarded.hp - 8);

    // Or twelve ticks: the same 12 Guard is gone with nothing hitting it.
    expect(decayGuard(guarded, 12).guard).toBe(0);
    expect(decayGuard(guarded, 5).guard).toBe(7);
  });

  it('never stacks past the cap, and never goes negative', () => {
    const actor = player(opened());
    expect(gainGuard(gainGuard(actor, 30), 30).guard).toBe(GUARD_CAP);
    expect(decayGuard(gainGuard(actor, 4), 99).guard).toBe(0);
  });

  it('is consumed before HP on every incoming hit', () => {
    const actor = gainGuard(player(opened()), 5);
    const struck = absorb(actor, 3);

    expect(struck.actor.guard).toBe(2);
    expect(struck.actor.hp).toBe(actor.hp);
  });

  it('decays one per tick as the scheduler advances', () => {
    const state = opened();
    const guarded = { ...state, actors: state.actors.map((a) => gainGuard(a, 10)) };
    const later = advanceTime(guarded, tick(guarded.now + 4));

    expect(player(later.state).guard).toBe(6);
  });
});

describe('Wait as defence (GDD §4.3)', () => {
  it('grants 3 Guard, which the next small hit runs into', () => {
    const waited = reduce(opened(), { kind: 'wait' });
    if (!waited.ok) throw new Error('wait is always legal');

    expect(player(waited.step.state).guard).toBe(WAIT_GUARD);
    expect(waited.step.events).toContainEqual(
      expect.objectContaining({ kind: 'guard_gained', amount: WAIT_GUARD }),
    );
  });

  it('is worth reading against the queue: 3 Guard does not survive 4 ticks', () => {
    const waited = reduce(opened(), { kind: 'wait' });
    if (!waited.ok) throw new Error('wait is always legal');

    const state = waited.step.state;
    expect(player(advanceTime(state, tick(state.now + 2)).state).guard).toBe(1);
    expect(player(advanceTime(state, tick(state.now + 4)).state).guard).toBe(0);
  });
});
