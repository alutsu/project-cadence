import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, RAT, WARDEN, ratAndWarden, soloRat } from '../../src/data/encounters.ts';
import { advanceToDecision, startCombat, type CombatSetup } from '../../src/sim/combat.ts';
import { forecastQueue, QUEUE_SLOTS } from '../../src/sim/forecast.ts';
import { cardId } from '../../src/sim/ids.ts';
import type { CombatState } from '../../src/sim/state.ts';

function opened(actors: CombatSetup['actors']): CombatState {
  const started = startCombat({ actors, catalogue: m0Catalogue(), hand: [cardId('strike')] });
  return advanceToDecision(started.state).state;
}

describe('the queue forecast (GDD §4.2)', () => {
  it('fills eight slots by default', () => {
    expect(forecastQueue(opened(soloRat()))).toHaveLength(QUEUE_SLOTS);
  });

  it('projects telegraphed enemy turns forward', () => {
    const forecast = forecastQueue(opened(soloRat()));

    expect(forecast.map((slot) => `${slot.actor}@${String(slot.at)}`)).toEqual([
      'player@6',
      'rat@9',
      'rat@13',
      'rat@17',
      'rat@21',
      'rat@25',
      'rat@29',
      'rat@33',
    ]);
  });

  it('orders a tie by effective Speed, exactly as the timeline does', () => {
    const forecast = forecastQueue(opened(ratAndWarden()), 5);

    // Rat and Warden both land on t9; the faster actor takes the slot first.
    expect(forecast.map((slot) => `${slot.actor}@${String(slot.at)}`)).toEqual([
      'player@6',
      'rat@9',
      'warden@9',
      'rat@13',
      'rat@17',
    ]);
  });

  it('shows the player exactly once, because their next Weight is their choice', () => {
    const forecast = forecastQueue(opened(ratAndWarden()));
    expect(forecast.filter((slot) => slot.actor === PLAYER)).toHaveLength(1);
  });

  it('stops early when nothing is left to project', () => {
    const state = opened(soloRat());
    const alone = { ...state, actors: state.actors.filter((actor) => actor.id !== RAT) };

    expect(forecastQueue(alone)).toEqual([{ actor: PLAYER, at: 6 }]);
  });

  it('omits the dead', () => {
    const state = opened(ratAndWarden());
    const withoutRat = {
      ...state,
      actors: state.actors.map((actor) => (actor.id === RAT ? { ...actor, hp: 0 } : actor)),
    };

    expect(forecastQueue(withoutRat).every((slot) => slot.actor !== RAT)).toBe(true);
    expect(forecastQueue(withoutRat).some((slot) => slot.actor === WARDEN)).toBe(true);
  });
});
