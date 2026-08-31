import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ENCOUNTERS, ratAndWarden, soloRat } from '../../src/data/encounters.ts';
import type { ActorSeed } from '../../src/sim/combat.ts';
import { startCombat, withDistinctNames } from '../../src/sim/combat.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import type { CombatState } from '../../src/sim/state.ts';

const CATALOGUE = m0Catalogue();

function fight(actors: readonly ActorSeed[]): CombatState {
  return startCombat({
    actors,
    catalogue: CATALOGUE,
    deck: Object.keys(CATALOGUE).map(cardId),
    rng: createRng(1, 'combat'),
  }).state;
}

function names(state: CombatState): readonly string[] {
  return state.actors.filter((actor) => actor.side === 'enemy').map((actor) => actor.name);
}

/**
 * A queue slot names an actor. Two actors with one name between them point at
 * no silhouette in particular (GDD §15, P5).
 */
describe('telling two of the same enemy apart', () => {
  it('numbers duplicates in seat order', () => {
    const scurry = ENCOUNTERS[0];
    if (scurry === undefined) throw new Error('no first encounter');

    expect(names(fight(scurry.actors))).toEqual(['Poison Rat 1', 'Poison Rat 2']);
  });

  it('leaves a name alone when there is nothing to tell it apart from', () => {
    expect(names(fight(soloRat()))).toEqual(['Poison Rat']);
    expect(names(fight(ratAndWarden()))).toEqual(['Poison Rat', 'Warden']);
  });

  it('numbers each duplicated name on its own count', () => {
    const seeds = [...(ENCOUNTERS[0]?.actors ?? []), ...ratAndWarden().slice(1)];
    const named = withDistinctNames(seeds).map((seed) => seed.name);

    expect(named).toEqual(['Adventurer', 'Poison Rat 1', 'Poison Rat 2', 'Poison Rat 3', 'Warden']);
  });

  it('keeps an ordinal for the whole encounter, however the line thins out', () => {
    const scurry = ENCOUNTERS[0];
    if (scurry === undefined) throw new Error('no first encounter');
    const state = fight(scurry.actors);

    // Rat 1 falls; Rat 2 is not renumbered into the seat it vacated. Identity
    // is what the strip is pointing at, not position.
    const survivors = state.actors.filter((actor) => actor.name !== 'Poison Rat 1');

    expect(survivors.map((actor) => actor.name)).toContain('Poison Rat 2');
  });
});
