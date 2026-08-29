import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat, type CombatStep } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import type { ActorId } from '../../src/sim/ids.ts';
import { cardId } from '../../src/sim/ids.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { CATALOGUE, HEAVY, LIGHT, PLAYER, RAT, scenario } from '../../src/sim-harness/scenario.ts';

/** Starts the scenario and runs time forward to the first player decision. */
function opening(): CombatStep {
  const started = startCombat(scenario());
  const advanced = advanceToDecision(started.state);
  return { state: advanced.state, events: [...started.events, ...advanced.events] };
}

/** Commits an action and runs time forward to the next player decision. */
function commit(state: CombatState, action: Action): CombatStep {
  const result = reduce(state, action);
  if (!result.ok) throw new Error(`action refused: ${result.error.reason}`);
  const advanced = advanceToDecision(result.step.state);
  return { state: advanced.state, events: [...result.step.events, ...advanced.events] };
}

function turnsTakenBy(events: readonly CombatEvent[], actor: ActorId): number {
  return events.filter((event) => event.kind === 'turn_started' && event.actor === actor).length;
}

function nextActTickOf(state: CombatState, actor: ActorId): number {
  const found = findActor(state, actor);
  if (found === undefined) throw new Error(`actor missing: ${actor}`);
  return found.nextActTick;
}

describe('combat start (GDD §4.1)', () => {
  it('seeds each actor at ceil(600 / speed) — the GDD worked example', () => {
    const { events } = startCombat(scenario());
    const scheduled = events.filter((event) => event.kind === 'actor_scheduled');

    expect(scheduled).toEqual([
      expect.objectContaining({ actor: PLAYER, nextActTick: 6 }),
      expect.objectContaining({ actor: RAT, nextActTick: 5 }),
    ]);
  });

  it('gives the first turn to the faster actor, with no coin flip', () => {
    const { state, events } = opening();
    const firstTurn = events.find((event) => event.kind === 'turn_started');

    expect(firstTurn).toMatchObject({ actor: RAT, at: 5 });
    expect(state.activeActorId).toBe(PLAYER);
    expect(state.now).toBe(6);
  });
});

describe('Weight moves the queue (GDD §4.1, pillar P1)', () => {
  it('puts the player behind two rat actions after a Heavy card', () => {
    const { state } = opening();
    const step = commit(state, { kind: 'play', card: HEAVY, target: RAT });

    expect(nextActTickOf(step.state, PLAYER)).toBe(16);
    expect(turnsTakenBy(step.events, RAT)).toBe(2);
    expect(step.state.now).toBe(16);
  });

  it('costs only one rat action for a Light card', () => {
    const { state } = opening();
    const step = commit(state, { kind: 'play', card: LIGHT, target: RAT });

    expect(nextActTickOf(step.state, PLAYER)).toBe(10);
    expect(turnsTakenBy(step.events, RAT)).toBe(1);
  });

  it('reschedules Wait by its Weight of 3 (GDD §4.3)', () => {
    const { state } = opening();
    const step = commit(state, { kind: 'wait' });

    expect(nextActTickOf(step.state, PLAYER)).toBe(9);
    expect(step.events.some((event) => event.kind === 'waited')).toBe(true);
  });
});

describe('the reducer refuses illegal actions (CLAUDE.md §5.4)', () => {
  it('rejects a card that is not in the catalogue', () => {
    const { state } = opening();
    const result = reduce(state, { kind: 'play', card: cardId('nonesuch'), target: RAT });

    expect(result).toEqual({ ok: false, error: { reason: 'unknown_card', card: 'nonesuch' } });
  });

  it('rejects a known card that is not in hand', () => {
    const { state } = opening();
    const outOfHand = { ...state, hand: [LIGHT] };
    const result = reduce(outOfHand, { kind: 'play', card: HEAVY, target: RAT });

    expect(result).toEqual({ ok: false, error: { reason: 'card_not_in_hand', card: HEAVY } });
  });

  it('rejects an action when it is not the player’s turn', () => {
    const { state } = opening();
    const committed = reduce(state, { kind: 'wait' });
    if (!committed.ok) throw new Error('wait should be legal');

    const result = reduce(committed.step.state, { kind: 'wait' });
    expect(result).toEqual({ ok: false, error: { reason: 'not_your_turn', activeActor: null } });
  });

  it('rejects a dead target rather than letting the UI be the only guard', () => {
    const { state } = opening();
    const corpse = {
      ...state,
      actors: state.actors.map((a) => (a.id === RAT ? { ...a, hp: 0 } : a)),
    };
    const result = reduce(corpse, { kind: 'play', card: LIGHT, target: RAT });

    expect(result).toEqual({ ok: false, error: { reason: 'target_is_dead', target: RAT } });
  });
});

describe('encounter end (GDD §4.10)', () => {
  it('ends when the last enemy dies, and refuses actions afterwards', () => {
    const { state } = opening();
    const frail = {
      ...state,
      actors: state.actors.map((a) => (a.id === RAT ? { ...a, hp: 5 } : a)),
    };
    const step = commit(frail, { kind: 'play', card: LIGHT, target: RAT });

    expect(step.state.outcome).toBe('won');
    expect(step.events).toContainEqual(expect.objectContaining({ kind: 'actor_died', actor: RAT }));
    expect(step.events).toContainEqual(
      expect.objectContaining({ kind: 'combat_ended', outcome: 'won' }),
    );
    expect(reduce(step.state, { kind: 'wait' })).toEqual({
      ok: false,
      error: { reason: 'combat_over' },
    });
  });

  it('ends when the player dies', () => {
    const { state } = opening();
    const doomed = {
      ...state,
      actors: state.actors.map((a) => (a.id === PLAYER ? { ...a, hp: 2 } : a)),
    };
    const step = commit(doomed, { kind: 'wait' });

    expect(step.state.outcome).toBe('lost');
  });

  it('leaves the catalogue untouched — loaded data is immutable (CLAUDE.md §3.2)', () => {
    const { state } = opening();
    commit(state, { kind: 'play', card: HEAVY, target: RAT });

    expect(state.catalogue).toEqual(CATALOGUE);
  });
});
