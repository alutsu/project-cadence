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
   * What this archetype costs an encounter's budget (§12.1, §12.2 [AMD]).
   *
   * §12.2 states the rule this number exists to encode: "a second enemy adds
   * its whole damage output while adding only its own HP to the pool", so a duo
   * must be built from cheaper parts than the solo fight before it. A budget
   * makes that arithmetic instead of a matter of judgement per encounter.
   */
  readonly cost: number;
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
  cost: 1,
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
  cost: 4,
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
  cost: 2,
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

/**
 * GDD §12.2: 50% Fire resist, retaliates on hit. The retaliation is deferred —
 * it needs a reactive hook the sim does not have — so what ships is the
 * resistance and a statline, and the name is claimed rather than the behaviour.
 * [M2 STAND-IN]
 */
export const EMBERHIDE: EnemyArchetype = {
  id: 'emberhide',
  name: 'Emberhide',
  baseSpeed: 100,
  baseHp: 44,
  basePoise: 10,
  cost: 2,
  // The archetype §7.2 exists for: a wall against exactly one tag.
  resistances: resistTo({ Fire: 0.5, Physical: 0.15 }),
  intents: [
    { name: 'Scald', weight: tick(6), damage: 5, applies: null },
    {
      name: 'Cinder',
      weight: tick(5),
      damage: 2,
      applies: { kind: 'burn', magnitude: 2, duration: tick(20) },
    },
  ],
};

/**
 * GDD §12.2: high HP, self-damage burst. The self-damage is the part that makes
 * it fair, and it is deferred with the same honesty as Emberhide's retaliation
 * — for now it is simply a slow, heavy body. [M2 STAND-IN]
 */
export const BERSERKER: EnemyArchetype = {
  id: 'berserker',
  name: 'Bleeding Berserker',
  baseSpeed: 90,
  baseHp: 62,
  basePoise: 14,
  cost: 3,
  resistances: resistTo({ Physical: 0.25, Shadow: 0.2 }),
  intents: [
    { name: 'Wild Swing', weight: tick(8), damage: 9, applies: null },
    {
      name: 'Rend',
      weight: tick(6),
      damage: 4,
      applies: { kind: 'bleed', magnitude: 3, duration: tick(18) },
    },
  ],
};

export const ARCHETYPES: readonly EnemyArchetype[] = [
  POISON_RAT,
  CHIME_ADEPT,
  EMBERHIDE,
  BERSERKER,
  WARDEN,
];
