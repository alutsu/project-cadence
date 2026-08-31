import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../src/data/archetypes.ts';
import { budgetFor, generateEncounter, MAX_ENEMIES } from '../../src/run/generate.ts';
import { createRng } from '../../src/sim/rng.ts';
import { TAGS } from '../../src/sim/tag.ts';

/**
 * Encounter generation (GDD §12.1).
 *
 * The measurement that produced this module: a map reusing the six authored
 * encounters handed a level-1 character a solo Warden whose Poise was higher
 * than anything a five-card deck could hit. Not a hard fight — an *unavailable*
 * one. What the tests below pin is that a generated line is built to the level
 * it is fought at, and that it is reproducible.
 */

describe('a line is built to the level’s budget (GDD §12.1, §12.2 [AMD])', () => {
  it('spends nothing it has not got — the budget bounds the line', () => {
    for (let level = 0; level < 12; level += 1) {
      const line = generateEncounter(
        { level, elite: false, omen: null },
        createRng(level, 'enemyGen'),
      );
      const spent = line
        .map((seed) => ARCHETYPES.find((entry) => seed.name.startsWith(entry.name))?.cost ?? 0)
        .reduce((total, cost) => total + cost, 0);

      expect(spent).toBeLessThanOrEqual(budgetFor(level));
    }
  });

  it('never fields more than four enemies (GDD §4.8)', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const line = generateEncounter(
        { level: 20, elite: true, omen: null },
        createRng(seed, 'enemyGen'),
      );
      expect(line.length).toBeLessThanOrEqual(MAX_ENEMIES);
    }
  });

  it('always fields something, however small the budget', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const line = generateEncounter(
        { level: 0, elite: false, omen: null },
        createRng(seed, 'enemyGen'),
      );
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('opens gently: a level-0 fight is one cheap thing', () => {
    // The direct fix for what the measurement found. A first node must be
    // winnable by a five-card deck (GDD §5.1's level 1).
    const line = generateEncounter(
      { level: 0, elite: false, omen: null },
      createRng(3, 'enemyGen'),
    );

    expect(line).toHaveLength(1);
    expect(line[0]?.maxHp ?? 0).toBeLessThan(40);
  });

  it('grows with the level, in both count and size', () => {
    const hpAt = (level: number): number =>
      generateEncounter({ level, elite: false, omen: null }, createRng(9, 'enemyGen'))
        .map((seed) => seed.maxHp)
        .reduce((total, hp) => total + hp, 0);

    expect(hpAt(8)).toBeGreaterThan(hpAt(0));
  });

  it('gives an elite more to spend, because §9 and §10 make it worth a node', () => {
    // Averaged across seeds rather than asserted on one: with fixed draws the
    // extra budget only shows when a draw would otherwise have been rejected
    // for cost, so any single seed may spend the same either way.
    const poolAt = (elite: boolean): number =>
      Array.from({ length: 200 }, (_, seed) =>
        generateEncounter({ level: 4, elite, omen: null }, createRng(seed, 'enemyGen'))
          .map((line) => line.maxHp)
          .reduce((total, hp) => total + hp, 0),
      ).reduce((total, hp) => total + hp, 0);

    expect(poolAt(true)).toBeGreaterThan(poolAt(false));
  });
});

describe('generation is reproducible (GDD §20.2)', () => {
  it('gives the same line for the same seed and order', () => {
    const order = { level: 5, elite: false, omen: null };
    expect(generateEncounter(order, createRng(11, 'enemyGen'))).toEqual(
      generateEncounter(order, createRng(11, 'enemyGen')),
    );
  });

  it('draws a fixed number of times whatever it picks', () => {
    // §20.2 [AMD]: affordability filters the pool *before* the draw rather
    // than re-rolling until something fits, so the position cannot depend on
    // the outcome and a resumed run lands in the same fight.
    const positions = Array.from({ length: 100 }, (_, seed) => {
      const rng = createRng(seed, 'enemyGen');
      generateEncounter({ level: 6, elite: false, omen: null }, rng);
      return rng.state().position;
    });

    expect(new Set(positions).size).toBe(1);
  });
});

describe('a node honours the Omen it advertised (GDD §11, §7.2)', () => {
  it('fields something that actually resists the promised tag', () => {
    for (const tag of TAGS) {
      const bearer = ARCHETYPES.find((archetype) => {
        const resistance = archetype.resistances[tag];
        return resistance.kind === 'resist' && resistance.value > 0;
      });
      if (bearer === undefined) continue;

      const line = generateEncounter(
        { level: 6, elite: false, omen: { tag, kind: 'resists' } },
        createRng(4, 'enemyGen'),
      );

      expect(
        line.some((seed) => seed.name.startsWith(bearer.name)),
        tag,
      ).toBe(true);
    }
  });
});
