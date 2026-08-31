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
import { actorDelay, type Actor } from '../../src/sim/actor.ts';
import { actorId } from '../../src/sim/ids.ts';
import { NO_RESISTANCE } from '../../src/sim/weave.ts';

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

  it('tells an actor what a Weight costs it right now (GDD §4.1)', () => {
    const base: Actor = {
      id: actorId('player'),
      name: 'Adventurer',
      side: 'player',
      index: 0,
      baseSpeed: BASE_SPEED,
      speedGain: 0,
      hp: 70,
      maxHp: 70,
      guard: 0,
      poise: 0,
      resistances: NO_RESISTANCE,
      staggersTaken: 0,
      statuses: [],
      nextActTick: tick(6),
      actionsCommitted: 0,
      intents: [],
      intentIndex: 0,
    };

    // At Speed 100 the two numbers coincide, which is why they are so easy to
    // confuse for one another everywhere else.
    expect(actorDelay(base, tick(4))).toBe(4);
    expect(actorDelay(base, tick(10))).toBe(10);

    const slowed: Actor = {
      ...base,
      statuses: [{ kind: 'slow', magnitude: 25, expiresAt: tick(24), nextProcAt: null }],
    };

    // Slow taxes every card, and the heavier one by more: ceil(w * 100 / 75).
    expect(actorDelay(slowed, tick(4))).toBe(6);
    expect(actorDelay(slowed, tick(10))).toBe(14);

    const hasted: Actor = {
      ...base,
      statuses: [{ kind: 'haste', magnitude: 25, expiresAt: tick(24), nextProcAt: null }],
    };

    expect(actorDelay(hasted, tick(4))).toBe(4);
    expect(actorDelay(hasted, tick(10))).toBe(8);
  });
});
