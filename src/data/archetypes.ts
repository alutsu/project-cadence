import type { Intent } from '../sim/actor.ts';
import { tick } from '../sim/tick.ts';

/**
 * Enemy archetypes (GDD §12.2). Three of the fourteen, chosen because between
 * them they exercise every system M0 built: a fast chipper with low Poise, a
 * slow hammer that telegraphs a Weight-16 swing, and a Speed manipulator.
 *
 * Intent rotations are deterministic and cycle in order. That is what lets the
 * eight-slot forecast stay honest all the way out (GDD §4.2) — a random intent
 * would make every slot past the first a guess.
 */
export interface EnemyArchetype {
  readonly id: string;
  readonly name: string;
  readonly baseSpeed: number;
  readonly baseHp: number;
  readonly basePoise: number;
  readonly intents: readonly Intent[];
}

/** Fast chip, low Poise — where a player learns Stagger exists. */
export const POISON_RAT: EnemyArchetype = {
  id: 'poison_rat',
  name: 'Poison Rat',
  baseSpeed: 130,
  baseHp: 26,
  basePoise: 7,
  intents: [
    { name: 'Gnaw', weight: tick(4), damage: 3, applies: null },
    {
      name: 'Venom Bite',
      weight: tick(5),
      damage: 2,
      // Poison ends by running out of magnitude, not on a clock (GDD §4.5).
      applies: { kind: 'poison', magnitude: 4, duration: null },
    },
  ],
};

/** Huge Poise, telegraphs a Weight-16 hit — the Stagger puzzle. */
export const WARDEN: EnemyArchetype = {
  id: 'warden',
  name: 'Warden',
  baseSpeed: 70,
  baseHp: 52,
  basePoise: 20,
  intents: [
    { name: 'Ruinous Swing', weight: tick(16), damage: 18, applies: null },
    { name: 'Backhand', weight: tick(6), damage: 7, applies: null },
  ],
};

/** Applies Slow, punishes Heavy cards — makes Speed felt in the queue. */
export const CHIME_ADEPT: EnemyArchetype = {
  id: 'chime_adept',
  name: 'Chime Adept',
  baseSpeed: 115,
  baseHp: 34,
  basePoise: 12,
  intents: [
    {
      name: 'Discordant Chime',
      weight: tick(6),
      damage: 5,
      applies: { kind: 'slow', magnitude: 25, duration: tick(18) },
    },
    { name: 'Toll', weight: tick(8), damage: 11, applies: null },
  ],
};

export const ARCHETYPES: readonly EnemyArchetype[] = [POISON_RAT, WARDEN, CHIME_ADEPT];
