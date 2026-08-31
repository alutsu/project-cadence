import { advanceOneTurn, type CombatStep } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import type { CombatState } from '../sim/state.ts';

/**
 * One beat of playback: a single turn resolving, and the state it left behind.
 *
 * `before` is where the beat started, because that is where a blow has to be
 * drawn — an enemy killed by this beat has already left the line in `after`,
 * and its death should still be shown at the seat it died in.
 */
export interface Beat {
  readonly before: CombatState;
  readonly after: CombatState;
  readonly events: readonly CombatEvent[];
}

/** Everything one committed action produced, split into the beats it plays as. */
export interface TurnBeats {
  readonly beats: readonly Beat[];
  /** Where the action left the encounter — the board the player acts from next. */
  readonly settled: CombatState;
  /** The whole log, in order, whether or not a beat was kept to show it. */
  readonly events: readonly CombatEvent[];
}

/**
 * The beats one committed action plays as: the player's own turn first, then
 * every turn that resolves before they act again.
 *
 * The queue used to jump straight from the action to the next decision, so
 * three enemy turns landed as one silent step and the strip's whole purpose —
 * showing who acts when (GDD §4.2) — was only legible in hindsight. Splitting
 * the same resolution into beats lets the strip drain a slot at a time.
 *
 * Nothing here decides anything. `advanceOneTurn` has already run by the time a
 * beat is handed out, so every beat is a record of something that is already
 * true, which is what makes skipping the playback safe (GDD §15). `settled` and
 * `events` are the whole outcome regardless of how many beats are shown, so a
 * caller can commit the result without walking them.
 */
export function beatsOf(before: CombatState, committed: CombatStep): TurnBeats {
  const beats: Beat[] = [{ before, after: committed.state, events: committed.events }];
  let current = committed.state;

  for (;;) {
    const advance = advanceOneTurn(current);
    beats.push({ before: current, after: advance.step.state, events: advance.step.events });
    current = advance.step.state;
    if (advance.kind !== 'settled') continue;

    return {
      beats: beats.filter(hasSomethingToShow),
      settled: current,
      events: beats.flatMap((beat) => [...beat.events]),
    };
  }
}

/**
 * A beat that emitted nothing changed nothing worth a pause — time reaching a
 * corpse's slot, most often. Holding the screen for one would read as a stutter.
 */
function hasSomethingToShow(beat: Beat): boolean {
  return beat.events.length > 0;
}
