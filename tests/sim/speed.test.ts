import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  MIN_EFFECTIVE_SPEED,
  SPEED_HARD_CAP,
  actionDelay,
  combatSeedTick,
  drawsOnAction,
  effectiveSpeed,
} from '../../src/sim/speed.ts';
import { tick } from '../../src/sim/tick.ts';

describe('effectiveSpeed (GDD §4.7)', () => {
  it('is linear up to the soft cap', () => {
    expect(effectiveSpeed(BASE_SPEED, 0)).toBe(100);
    expect(effectiveSpeed(BASE_SPEED, 40)).toBe(140);
  });

  it('halves gain beyond the soft cap', () => {
    expect(effectiveSpeed(BASE_SPEED, 60)).toBe(150);
    expect(effectiveSpeed(BASE_SPEED, 100)).toBe(170);
  });

  it('never exceeds the hard cap', () => {
    expect(effectiveSpeed(BASE_SPEED, 500)).toBe(SPEED_HARD_CAP);
  });

  it('subtracts Slow, down to a floor that keeps the delay formula finite', () => {
    expect(effectiveSpeed(BASE_SPEED, -30)).toBe(70);
    expect(effectiveSpeed(BASE_SPEED, -500)).toBe(MIN_EFFECTIVE_SPEED);
  });

  it('applies the same curve to enemy base speeds (GDD §12.2)', () => {
    expect(effectiveSpeed(70, 0)).toBe(70);
    expect(effectiveSpeed(130, 0)).toBe(130);
    expect(effectiveSpeed(115, -20)).toBe(95);
  });
});

describe('actionDelay (GDD §4.1)', () => {
  it('matches the published Weight classes at Speed 100', () => {
    expect(actionDelay(tick(4), 100)).toBe(4);
    expect(actionDelay(tick(6), 100)).toBe(6);
    expect(actionDelay(tick(10), 100)).toBe(10);
    expect(actionDelay(tick(16), 100)).toBe(16);
  });

  it('rounds up, so speed never buys a free fraction of a tick', () => {
    expect(actionDelay(tick(4), 130)).toBe(4);
    expect(actionDelay(tick(10), 130)).toBe(8);
    expect(actionDelay(tick(4), 70)).toBe(6);
  });
});

describe('combatSeedTick (GDD §4.1)', () => {
  it('seeds the worked example from the GDD', () => {
    expect(combatSeedTick(100)).toBe(6);
    expect(combatSeedTick(130)).toBe(5);
  });

  it('seeds the slow and mid archetypes', () => {
    expect(combatSeedTick(70)).toBe(9);
    expect(combatSeedTick(115)).toBe(6);
  });
});

describe('drawsOnAction (GDD §4.7 [AMD])', () => {
  it('draws every action at or below the soft cap', () => {
    expect(drawsOnAction(140, 0)).toBe(true);
    expect(drawsOnAction(140, 1)).toBe(true);
  });

  it('draws every other own action above it', () => {
    expect(drawsOnAction(150, 0)).toBe(true);
    expect(drawsOnAction(150, 1)).toBe(false);
    expect(drawsOnAction(150, 2)).toBe(true);
  });
});
