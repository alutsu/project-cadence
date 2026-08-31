import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/sim/actions.ts';
import {
  advanceOneTurn,
  advanceToDecision,
  reduce,
  startCombat,
  type Advance,
} from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { playerActor, type CombatState } from '../../src/sim/state.ts';
import { HEAVY, PLAYER, RAT, scenario } from '../../src/sim-harness/scenario.ts';

function opening(): CombatState {
  return advanceToDecision(startCombat(scenario()).state).state;
}

function commit(state: CombatState, action: Action): CombatState {
  const result = reduce(state, action);
  if (!result.ok) throw new Error(`action refused: ${result.error.reason}`);
  return result.step.state;
}

/** Walks time one turn at a time, collecting what each step produced. */
function stepwise(state: CombatState): { steps: Advance[]; events: CombatEvent[] } {
  const steps: Advance[] = [];
  const events: CombatEvent[] = [];
  let current = state;

  for (;;) {
    const advance = advanceOneTurn(current);
    steps.push(advance);
    events.push(...advance.step.events);
    current = advance.step.state;
    if (advance.kind === 'settled') return { steps, events };
  }
}

describe('advanceOneTurn (GDD §4.1)', () => {
  it('resolves one enemy turn per step, then reports where time stopped', () => {
    const committed = commit(opening(), { kind: 'play', card: HEAVY, target: RAT });
    const { steps } = stepwise(committed);

    // A Heavy card puts the player behind the rat, so time passes through at
    // least one enemy turn before the next decision.
    const turns = steps.filter((step) => step.kind === 'turn');
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.map((turn) => turn.actor)).toEqual(turns.map(() => RAT));

    // Only the last step settles, and it settles exactly once.
    expect(steps.filter((step) => step.kind === 'settled')).toHaveLength(1);
    expect(steps[steps.length - 1]?.kind).toBe('settled');
  });

  it('never takes more than one enemy turn in a single step', () => {
    const committed = commit(opening(), { kind: 'play', card: HEAVY, target: RAT });
    const { steps } = stepwise(committed);

    for (const step of steps) {
      const started = step.step.events.filter((event) => event.kind === 'turn_started');
      expect(started.length).toBeLessThanOrEqual(1);
    }
  });

  it('lands on the same state and the same log as resolving in one go', () => {
    const committed = commit(opening(), { kind: 'play', card: HEAVY, target: RAT });
    const wholesale = advanceToDecision(committed);
    const piecemeal = stepwise(committed);

    expect(piecemeal.events).toEqual(wholesale.events);
    expect(piecemeal.steps[piecemeal.steps.length - 1]?.step.state).toEqual(wholesale.state);
  });

  it('stops on a finished encounter without advancing time', () => {
    const state = opening();
    const over: CombatState = { ...state, outcome: 'won' };
    const advance = advanceOneTurn(over);

    expect(advance.kind).toBe('settled');
    expect(advance.step.events).toEqual([]);
    expect(advance.step.state.now).toBe(over.now);
  });

  it('opens the player turn on the step that settles', () => {
    const committed = commit(opening(), { kind: 'play', card: HEAVY, target: RAT });
    const { steps } = stepwise(committed);
    const last = steps[steps.length - 1];

    expect(last?.step.state.activeActorId).toBe(PLAYER);
    expect(playerActor(last?.step.state ?? committed)?.hp).toBeGreaterThan(0);
  });
});
