import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ARCHETYPES, WARDEN as WARDEN_ARCHETYPE } from '../../src/data/archetypes.ts';
import {
  CHAIN_SIZE,
  ENCOUNTERS,
  PLAYER,
  PLAYER_MAX_HP,
  scaleEnemy,
  startsChain,
} from '../../src/data/encounters.ts';
import { TAGS } from '../../src/sim/tag.ts';
import { MAX_RESISTANCE } from '../../src/sim/weave.ts';
import { advanceToDecision, startCombat } from '../../src/sim/combat.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { findActor } from '../../src/sim/state.ts';

function openingOf(index: number, hp: number) {
  const encounter = ENCOUNTERS[index];
  if (encounter === undefined) throw new Error(`no encounter at ${String(index)}`);
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: encounter.actors.map((actor) => (actor.side === 'player' ? { ...actor, hp } : actor)),
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    rng: createRng(1, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

describe('carrying a wound between encounters (GDD §4.10)', () => {
  it('starts the player on the health they were given, not a full pool', () => {
    const state = openingOf(1, 23);

    expect(findActor(state, PLAYER)?.hp).toBe(23);
    expect(findActor(state, PLAYER)?.maxHp).toBe(PLAYER_MAX_HP);
  });

  it('starts every enemy whole — only the player carries a wound', () => {
    const state = openingOf(0, 10);
    const enemies = state.actors.filter((actor) => actor.side === 'enemy');

    expect(enemies).not.toHaveLength(0);
    for (const enemy of enemies) expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('refuses a carried value that is not a living fraction of the pool', () => {
    expect(() => openingOf(0, 0)).toThrow(/outside 1\.\./);
    expect(() => openingOf(0, PLAYER_MAX_HP + 1)).toThrow(/outside 1\.\./);
  });
});

describe('the chain that stands in for a Sanctum (GDD §11, M0)', () => {
  it('rests at the first encounter and every CHAIN_SIZE after it', () => {
    const resting = ENCOUNTERS.map((_, index) => startsChain(index));

    expect(resting[0]).toBe(true);
    expect(resting.filter(Boolean)).toHaveLength(ENCOUNTERS.length / CHAIN_SIZE);
  });

  it('never leaves a chain longer than CHAIN_SIZE fights on one pool of HP', () => {
    let sinceRest = 0;
    for (const [index] of ENCOUNTERS.entries()) {
      sinceRest = startsChain(index) ? 1 : sinceRest + 1;
      expect(sinceRest).toBeLessThanOrEqual(CHAIN_SIZE);
    }
  });
});

/**
 * GDD §7.2, and docs/M1_PLAN.md D22. The numbers themselves are a balance
 * question for S8; what is asserted here is the shape the rule requires — that
 * resistance is inside its range, that it reaches the actor the reducer sees,
 * and that it does not scale, which is what would turn the Weave into a tax on
 * depth rather than a question about which card to reach for.
 */
describe('enemy tag resistance (GDD §7.2, §12.1)', () => {
  it('keeps every archetype inside the 0-60% range', () => {
    const every = ARCHETYPES.flatMap((archetype) =>
      TAGS.map((tag) => ({ name: archetype.name, resistance: archetype.resistances[tag] })),
    );

    for (const { name, resistance } of every) {
      expect(resistance.kind, name).toBe('resist');
      const value = resistance.kind === 'resist' ? resistance.value : Number.NaN;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(MAX_RESISTANCE);
    }
  });

  it('leaves one tag unresisted across the whole roster, so no fight can brick', () => {
    const unresisted = TAGS.filter((tag) =>
      ARCHETYPES.every((archetype) => {
        const resistance = archetype.resistances[tag];
        return resistance.kind === 'resist' && resistance.value === 0;
      }),
    );

    expect(unresisted.length).toBeGreaterThan(0);
  });

  it('carries resistance onto the seeded actor, unscaled by level', () => {
    const low = scaleEnemy(WARDEN_ARCHETYPE, 0, 'w0');
    const high = scaleEnemy(WARDEN_ARCHETYPE, 4, 'w4');

    expect(low.resistances).toEqual(WARDEN_ARCHETYPE.resistances);
    expect(high.resistances).toEqual(low.resistances);
  });
});
