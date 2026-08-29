import { describe, expect, it } from 'vitest';
import { createRng, restoreRng } from '../../src/sim/rng.ts';

const SEED = 1234;

describe('seeded streams (GDD §20.2)', () => {
  it('is reproducible for one seed and stream', () => {
    const draw = (): number[] => {
      const rng = createRng(SEED, 'combat');
      return [rng.nextFloat(), rng.nextFloat(), rng.nextFloat()];
    };
    expect(draw()).toEqual(draw());
  });

  it('gives different sequences to different streams', () => {
    const combat = createRng(SEED, 'combat');
    const gems = createRng(SEED, 'gemRoll');
    expect(combat.nextFloat()).not.toBe(gems.nextFloat());
  });

  it('keeps streams independent — consuming one does not shift another', () => {
    const untouched = createRng(SEED, 'combat').nextFloat();

    const gems = createRng(SEED, 'gemRoll');
    for (let i = 0; i < 50; i += 1) gems.nextFloat();

    expect(createRng(SEED, 'combat').nextFloat()).toBe(untouched);
  });

  it('resumes from a saved position (GDD §16)', () => {
    const original = createRng(SEED, 'enemyGen');
    original.nextFloat();
    original.nextFloat();
    const saved = original.state();

    expect(restoreRng(saved).nextFloat()).toBe(original.nextFloat());
    expect(saved.position).toBe(2);
  });

  it('bounds nextInt and rejects a non-positive bound', () => {
    const rng = createRng(SEED, 'map');
    for (let i = 0; i < 200; i += 1) {
      const value = rng.nextInt(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
    expect(() => rng.nextInt(0)).toThrow(RangeError);
  });
});
