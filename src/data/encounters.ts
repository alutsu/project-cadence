import type { ActorSeed } from '../sim/combat.ts';
import { actorId } from '../sim/ids.ts';
import {
  CHIME_ADEPT,
  POISON_RAT,
  WARDEN as WARDEN_ARCHETYPE,
  type EnemyArchetype,
} from './archetypes.ts';

export const PLAYER = actorId('player');
export const RAT = actorId('rat');
export const WARDEN = actorId('warden');
export const ADEPT = actorId('adept');

/** GDD §5.1: the player starts at Speed 100 with 70 Max HP. */
const PLAYER_SEED: ActorSeed = {
  id: PLAYER,
  name: 'Adventurer',
  side: 'player',
  baseSpeed: 100,
  maxHp: 70,
  // The player has no Poise: Stagger is something you do to enemies (GDD §4.6).
  poise: 0,
  intents: [],
};

/**
 * GDD §12.1. Speed deliberately does not scale: if enemy Speed grew with level,
 * the queue-planning skill would degrade over a run.
 */
export function scaleEnemy(archetype: EnemyArchetype, level: number, id: string): ActorSeed {
  return {
    id: actorId(id),
    name: archetype.name,
    side: 'enemy',
    baseSpeed: archetype.baseSpeed,
    maxHp: Math.round(archetype.baseHp * (1 + 0.22 * level)),
    poise: Math.round(archetype.basePoise * (1 + 0.12 * level)),
    intents: archetype.intents.map((intent) => ({
      ...intent,
      damage: Math.round(intent.damage * (1 + 0.16 * level)),
    })),
  };
}

const M0_LEVEL = 1;

function rat(id = 'rat'): ActorSeed {
  return scaleEnemy(POISON_RAT, M0_LEVEL, id);
}

function warden(id = 'warden'): ActorSeed {
  return scaleEnemy(WARDEN_ARCHETYPE, M0_LEVEL, id);
}

function adept(id = 'adept'): ActorSeed {
  return scaleEnemy(CHIME_ADEPT, M0_LEVEL, id);
}

export interface Encounter {
  readonly name: string;
  readonly teaches: string;
  readonly actors: readonly ActorSeed[];
}

/**
 * The M0 encounter set. Ordered as a teaching sequence: each one isolates a
 * system before the last one asks for all of them at once.
 */
export const ENCOUNTERS: readonly Encounter[] = [
  {
    name: 'Scurry',
    teaches: 'Weight moves the queue; a Light card can outrun a bite.',
    actors: [PLAYER_SEED, rat(), rat('rat_b')],
  },
  {
    name: 'The Long Wind',
    teaches: 'Read eight slots ahead: the swing is visible before it lands.',
    actors: [PLAYER_SEED, warden()],
  },
  {
    name: 'Discord',
    teaches: 'Slow is a queue effect — Heavy cards cost more while it holds.',
    actors: [PLAYER_SEED, adept()],
  },
  {
    name: 'Guarded Approach',
    teaches: 'Stagger the swing, or hold Guard for it.',
    actors: [PLAYER_SEED, warden(), rat()],
  },
  {
    name: 'The Toll',
    teaches: 'Two clocks at once: chip damage and a wind-up.',
    actors: [PLAYER_SEED, adept(), rat()],
  },
  {
    name: 'Full Consort',
    teaches: 'Everything together, and not enough turns for all of it.',
    actors: [PLAYER_SEED, warden(), adept(), rat()],
  },
];

/** The fixed regression scenario: one player, one fast enemy (GDD §4.1). */
export function soloRat(): readonly ActorSeed[] {
  return [PLAYER_SEED, rat()];
}

export function ratAndWarden(): readonly ActorSeed[] {
  return [PLAYER_SEED, rat(), warden()];
}
