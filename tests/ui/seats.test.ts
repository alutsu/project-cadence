import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ENCOUNTERS, PLAYER, RAT } from '../../src/data/encounters.ts';
import { startCombat } from '../../src/sim/combat.ts';
import { actorId, cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { livingEnemies } from '../../src/sim/state.ts';
import { enemySeat } from '../../src/ui/EnemyLine.ts';
import { handSeat } from '../../src/ui/Hand.ts';
import { LAYOUT } from '../../src/ui/theme.ts';

const CENTRE = LAYOUT.width / 2;

function opening(index: number) {
  const encounter = ENCOUNTERS[index];
  if (encounter === undefined) throw new Error(`no encounter at ${String(index)}`);
  const catalogue = m0Catalogue();
  return startCombat({
    actors: encounter.actors,
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    rng: createRng(1, 'combat'),
  }).state;
}

/**
 * These two are the only shared geometry in the UI: the views draw from them
 * and the strike animation aims at them. If they drift, a card flies at empty
 * space — so they are worth pinning even though rendering is not tested.
 */
describe('where the hand and the enemy line sit', () => {
  it('centres a lone card and spreads the rest evenly around the middle', () => {
    const { cardWidth, gap, baselineY, lift } = LAYOUT.hand;

    expect(handSeat({ index: 0, count: 1 })).toEqual({ x: CENTRE, y: baselineY });

    const step = cardWidth + gap;
    expect(handSeat({ index: 0, count: 2 }).x).toBe(CENTRE - step / 2);
    expect(handSeat({ index: 1, count: 2 }).x).toBe(CENTRE + step / 2);
    // The fan is an arc, so the outer cards sit lower (GDD §15.1).
    expect(handSeat({ index: 0, count: 3 }).y).toBe(baselineY + lift);
    expect(handSeat({ index: 1, count: 3 }).y).toBe(baselineY);
  });

  it('places a single enemy dead ahead and a pair either side of it', () => {
    const solo = opening(1);
    const alone = livingEnemies(solo)[0];
    if (alone === undefined) throw new Error('encounter has no enemy');
    expect(enemySeat(solo, alone.id)?.x).toBe(CENTRE);

    const pair = opening(0);
    const seats = livingEnemies(pair).map((enemy) => enemySeat(pair, enemy.id)?.x);
    const step = LAYOUT.enemies.width + LAYOUT.enemies.gap;
    expect(seats).toEqual([CENTRE - step / 2, CENTRE + step / 2]);
  });

  it('has no seat for the player, or for an enemy that is no longer standing', () => {
    const state = opening(0);

    expect(enemySeat(state, PLAYER)).toBeNull();
    expect(enemySeat(state, actorId('nobody'))).toBeNull();

    const fallen = {
      ...state,
      actors: state.actors.map((actor) => (actor.id === RAT ? { ...actor, hp: 0 } : actor)),
    };
    expect(enemySeat(fallen, RAT)).toBeNull();
    // The survivor closes ranks, which is why a blow is drawn from the state
    // that was true before it landed.
    expect(livingEnemies(fallen)).toHaveLength(1);
    expect(enemySeat(fallen, livingEnemies(fallen)[0]?.id ?? PLAYER)?.x).toBe(CENTRE);
  });
});
