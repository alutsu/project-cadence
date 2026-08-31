import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat, type CombatStep } from '../../src/sim/combat.ts';
import type { CombatState } from '../../src/sim/state.ts';
import { beatsOf } from '../../src/ui/turnBeats.ts';
import { HEAVY, LIGHT, PLAYER, RAT, scenario } from '../../src/sim-harness/scenario.ts';

function opening(): CombatState {
  return advanceToDecision(startCombat(scenario()).state).state;
}

function commit(state: CombatState, action: Action): CombatStep {
  const result = reduce(state, action);
  if (!result.ok) throw new Error(`action refused: ${result.error.reason}`);
  return result.step;
}

describe('turn beats (GDD §4.2, §15)', () => {
  it('settles exactly where resolving the whole turn at once settles', () => {
    const state = opening();
    const committed = commit(state, { kind: 'play', card: HEAVY, target: RAT });
    const played = beatsOf(state, committed);
    const wholesale = advanceToDecision(committed.state);

    expect(played.settled).toEqual(wholesale.state);
    expect(played.events).toEqual([...committed.events, ...wholesale.events]);
  });

  it('opens on the player’s own action, before any enemy answers it', () => {
    const state = opening();
    const played = beatsOf(state, commit(state, { kind: 'play', card: HEAVY, target: RAT }));
    const first = played.beats[0];

    expect(first?.before).toEqual(state);
    expect(first?.events[0]).toMatchObject({ kind: 'card_played', actor: PLAYER, card: HEAVY });
  });

  it('gives each enemy turn a beat of its own', () => {
    const state = opening();
    const played = beatsOf(state, commit(state, { kind: 'play', card: HEAVY, target: RAT }));

    for (const beat of played.beats) {
      const started = beat.events.filter((event) => event.kind === 'turn_started');
      expect(started.length).toBeLessThanOrEqual(1);
    }
    // A Heavy card cedes the queue, so the rat acts before the player does.
    expect(played.beats.length).toBeGreaterThan(1);
  });

  it('runs forward in time and ends on the settled board', () => {
    const state = opening();
    const played = beatsOf(state, commit(state, { kind: 'play', card: LIGHT, target: RAT }));

    // Drawing each beat's `after` in order is the whole playback, so the last
    // one has to be the board the player will act from.
    expect(played.beats[played.beats.length - 1]?.after).toEqual(played.settled);

    const clock = played.beats.map((beat) => beat.after.now);
    expect(clock).toEqual([...clock].sort((left, right) => left - right));
  });

  it('holds no beat for a turn that changed nothing', () => {
    const state = opening();
    const played = beatsOf(state, commit(state, { kind: 'play', card: HEAVY, target: RAT }));

    for (const beat of played.beats) expect(beat.events.length).toBeGreaterThan(0);
  });
});
