import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { formatEvent } from '../../src/sim-harness/format.ts';
import { HEAVY, LIGHT, PLAYER, RAT, STANDARD, scenario } from '../../src/sim-harness/scenario.ts';

const SCRIPT: readonly Action[] = [
  { kind: 'play', card: HEAVY, target: RAT },
  { kind: 'wait' },
  { kind: 'play', card: LIGHT, target: RAT },
  { kind: 'play', card: STANDARD, target: RAT },
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
      't0 drew lunge',
      't0 drew cleave',
      't0 no draw (draw_pile_empty)',
      't0 no draw (draw_pile_empty)',
      // The rat is faster, so it opens; no coin flip (GDD §4.1).
      't5 turn rat',
      't5 intent rat Gnaw',
      't5 damage rat -> player 2',
      't5 scheduled rat -> t9',
      't6 turn player',
      't6 no draw (draw_pile_empty)',
      // A Heavy card costs ten ticks — but 24 damage clears the rat's Poise
      // threshold, so the bite due at t9 slides to t12 (GDD §4.6).
      't6 played player crush w10',
      't6 damage player -> rat 24',
      't6 staggered rat +3',
      // Recovery 26: gone until t32, and the strip can say so in advance.
      't6 cooldown crush -> t32',
      't6 scheduled player -> t16',
      // The rat's rotation has advanced: the second intent carries Poison.
      't12 turn rat',
      't12 intent rat Venom Bite',
      't12 damage rat -> player 1',
      't12 poison player 2',
      't12 scheduled rat -> t16',
      // Both are due at t16; the rat is faster, so it bites first (GDD §4.1).
      't16 turn rat',
      't16 intent rat Gnaw',
      't16 damage rat -> player 2',
      't16 scheduled rat -> t20',
      't16 turn player',
      't16 no draw (draw_pile_empty)',
      // Wait is Weight 3 (GDD §4.3), so the player is back before the rat.
      't16 waited player',
      't16 no draw (draw_pile_empty)',
      't16 guard player +3',
      't16 scheduled player -> t19',
      // Poison runs on its own five-tick clock and ignores Guard (GDD §4.5).
      't17 poison player ticks 2',
      't19 turn player',
      't19 no draw (draw_pile_empty)',
      't19 played player lunge w4',
      't19 damage player -> rat 11',
      // The second Stagger of the encounter, worth one tick less than the
      // first — the ladder halving down toward its floor (GDD §4.6).
      't19 staggered rat +2',
      't19 cooldown lunge -> t27',
      't19 scheduled player -> t23',
      // Poison ends by running out of magnitude, not on a clock (GDD §4.5).
      't22 poison player ticks 1',
      't22 turn rat',
      't22 intent rat Venom Bite',
      't22 damage rat -> player 1',
      't22 poison player 2',
      't22 scheduled rat -> t26',
      't23 turn player',
      't23 no draw (draw_pile_empty)',
      't23 played player cleave w6',
      // Cleave hits everything for 60% of its printed 14 (GDD §4.8); with one
      // rat left standing that is 8, and 8 is enough.
      't23 damage player -> rat 8',
      't23 died rat',
      't23 cooldown cleave -> t37',
      't23 scheduled player -> t29',
      // The encounter closes only after the turn that ended it has resolved.
      't23 combat_ended won',
    ]);
  });

  it('leaves the survivors in the state the log describes', () => {
    const { state } = play(SCRIPT);

    expect(state.outcome).toBe('won');
    expect(findActor(state, PLAYER)?.hp).toBe(61);
    expect(findActor(state, RAT)?.hp).toBe(0);
  });
});
