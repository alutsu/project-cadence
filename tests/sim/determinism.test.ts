import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { formatEvent } from '../../src/sim-harness/format.ts';
import { HEAVY, LIGHT, PLAYER, RAT, scenario } from '../../src/sim-harness/scenario.ts';

const SCRIPT: readonly Action[] = [
  { kind: 'play', card: HEAVY, target: RAT },
  { kind: 'wait' },
  { kind: 'play', card: LIGHT, target: RAT },
];

interface Run {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

function play(script: readonly Action[]): Run {
  const started = startCombat(scenario());
  const opening = advanceToDecision(started.state);
  const events: CombatEvent[] = [...started.events, ...opening.events];
  let state = opening.state;

  for (const action of script) {
    if (state.outcome !== 'ongoing') break;
    const result = reduce(state, action);
    if (!result.ok) throw new Error(`scripted action refused: ${result.error.reason}`);
    const advanced = advanceToDecision(result.step.state);
    events.push(...result.step.events, ...advanced.events);
    state = advanced.state;
  }

  return { state, events };
}

describe('determinism (GDD §20.2, CLAUDE.md §7.2)', () => {
  it('produces an identical event log for the same actions', () => {
    const first = play(SCRIPT);
    const second = play(SCRIPT);

    expect(second.events).toEqual(first.events);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
  });

  it('matches the golden log for the opening encounter', () => {
    const { events } = play(SCRIPT);

    expect(events.map(formatEvent)).toEqual([
      't0 combat_started',
      't0 scheduled player -> t6',
      't0 scheduled rat -> t5',
      // A three-card deck cannot fill the five-card opening hand, and the pile
      // is never topped up early (GDD §4.9).
      't0 drew crush',
      't0 drew strike',
      't0 drew cleave',
      't0 no draw (draw_pile_empty)',
      't0 no draw (draw_pile_empty)',
      // The rat is faster, so it opens; no coin flip (GDD §4.1).
      't5 turn rat',
      't5 intent rat Gnaw',
      't5 damage rat -> player 3',
      't5 scheduled rat -> t9',
      't6 turn player',
      't6 no draw (draw_pile_empty)',
      // A Heavy card costs ten ticks, and the rat takes two turns inside them.
      't6 played player crush w10',
      't6 damage player -> rat 24',
      // Recovery 26: gone until t32, and the strip can say so in advance.
      't6 cooldown crush -> t32',
      't6 scheduled player -> t16',
      't9 turn rat',
      't9 intent rat Gnaw',
      't9 damage rat -> player 3',
      't9 scheduled rat -> t13',
      't13 turn rat',
      't13 intent rat Gnaw',
      't13 damage rat -> player 3',
      't13 scheduled rat -> t17',
      't16 turn player',
      't16 no draw (draw_pile_empty)',
      // Wait is Weight 3 (GDD §4.3), so the player is back before the rat.
      't16 waited player',
      't16 no draw (draw_pile_empty)',
      // Wait's 3 Guard is 3 ticks of protection or one small hit (GDD §4.4).
      't16 guard player +3',
      't16 scheduled player -> t19',
      't17 turn rat',
      't17 intent rat Gnaw',
      't17 damage rat -> player 3',
      // One tick of decay later, 2 Guard is left, and it eats most of the bite.
      't17 guard player absorbed 2',
      't17 scheduled rat -> t21',
      't19 turn player',
      't19 no draw (draw_pile_empty)',
      't19 played player strike w4',
      't19 damage player -> rat 9',
      't19 died rat',
      't19 cooldown strike -> t27',
      't19 scheduled player -> t23',
      // The encounter closes only after the turn that ended it has resolved.
      't19 combat_ended won',
    ]);
  });

  it('leaves the survivors in the state the log describes', () => {
    const { state } = play(SCRIPT);

    expect(state.outcome).toBe('won');
    expect(findActor(state, PLAYER)?.hp).toBe(60);
    expect(findActor(state, RAT)?.hp).toBe(0);
  });
});
