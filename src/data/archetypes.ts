import type { Intent } from '../sim/actor.ts';
import { tick } from '../sim/tick.ts';
import { resistTo, type ResistanceTable } from '../sim/weave.ts';

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
  /**
   * GDD §7.2, and hand-authored rather than generated: §12.1's generator is
   * M2's. Speed never scales with level and neither does this — a resistance
   * that grew would make the Weave a tax on depth rather than a question about
   * which card to reach for.
   *
   * Fire is deliberately unresisted by all three. It is the tag Cataclysm
   * carries, and leaving one reliable line open means no encounter can become
   * unwinnable in the sprint that first makes tags matter. It is the first
   * number to move at the S8 balance pass, not a claim that Fire is special.
   */
  readonly resistances: ResistanceTable;
  readonly intents: readonly Intent[];
}

/** Fast chip, low Poise — where a player learns Stagger exists. */
export const POISON_RAT: EnemyArchetype = {
  id: 'poison_rat',
  name: 'Poison Rat',
  baseSpeed: 130,
  baseHp: 34,
  basePoise: 7,
  // Vermin that lives where the light does not. Light, because this is the
  // enemy a player meets first and the Weave should not be the lesson.
  resistances: resistTo({ Shadow: 0.3 }),
  intents: [
    { name: 'Gnaw', weight: tick(4), damage: 2, applies: null },
    {
      name: 'Venom Bite',
      weight: tick(5),
      damage: 1,
      // Poison ends by running out of magnitude, not on a clock (GDD §4.5).
      applies: { kind: 'poison', magnitude: 2, duration: null },
    },
  ],
};

/** Huge Poise, telegraphs a Weight-16 hit — the Stagger puzzle. */
export const WARDEN: EnemyArchetype = {
  id: 'warden',
  name: 'Warden',
  baseSpeed: 70,
  baseHp: 72,
  basePoise: 20,
  // Armour. This is the archetype the resistance rule exists for: the Warden is
  // already the fight you solve rather than out-damage (§12.2), and shrugging
  // off the deck's most repeated tag pushes the answer off Lunge and Crush.
  resistances: resistTo({ Physical: 0.4, Frost: 0.2 }),
  intents: [
    { name: 'Ruinous Swing', weight: tick(16), damage: 11, applies: null },
    { name: 'Backhand', weight: tick(6), damage: 3, applies: null },
  ],
};

/** Applies Slow, punishes Heavy cards — makes Speed felt in the queue. */
export const CHIME_ADEPT: EnemyArchetype = {
  id: 'chime_adept',
  name: 'Chime Adept',
  baseSpeed: 115,
  baseHp: 48,
  basePoise: 12,
  // A thing made of resonance is not moved by a wide arc or a clever one.
  resistances: resistTo({ Storm: 0.5, Arcane: 0.3 }),
  intents: [
    {
      name: 'Discordant Chime',
      weight: tick(6),
      damage: 3,
      applies: { kind: 'slow', magnitude: 25, duration: tick(18) },
    },
    { name: 'Toll', weight: tick(8), damage: 6, applies: null },
  ],
};

export const ARCHETYPES: readonly EnemyArchetype[] = [POISON_RAT, WARDEN, CHIME_ADEPT];
