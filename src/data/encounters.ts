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
export const PLAYER_MAX_HP = 70;

/** The player as an actor. §12.1 generates the rest of the line. */
export const PLAYER_SEED: ActorSeed = {
  id: PLAYER,
  name: 'Adventurer',
  side: 'player',
  baseSpeed: 100,
  maxHp: PLAYER_MAX_HP,
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
    // Like Speed, resistance does not scale (GDD §12.1): what an enemy shrugs
    // off is what it *is*, and a level is how much of it there is.
    resistances: archetype.resistances,
    intents: archetype.intents.map((intent) => ({
      ...intent,
      damage: Math.round(intent.damage * (1 + 0.16 * level)),
    })),
  };
}

/**
 * Enemy level is the composition lever (GDD §12.1). An archetype's base numbers
 * are its *add* strength — what it is worth standing beside something bigger.
 * A solo fight raises the level instead of swapping in a different enemy, so one
 * archetype covers both roles and neither needs a hand-written second statline.
 *
 * The spread matters more than it looks: a second enemy adds its whole damage
 * output while adding only its own HP to the pool, so a duo has to be built from
 * cheaper parts than the solo fight it follows.
 */
const SOLO_LEVEL = 2;
const PAIR_LEVEL = 1;
const CROWD_LEVEL = 0;

function rat(level: number, id = 'rat'): ActorSeed {
  return scaleEnemy(POISON_RAT, level, id);
}

function warden(level: number, id = 'warden'): ActorSeed {
  return scaleEnemy(WARDEN_ARCHETYPE, level, id);
}

function adept(level: number, id = 'adept'): ActorSeed {
  return scaleEnemy(CHIME_ADEPT, level, id);
}

/**
 * How many encounters are fought on one pool of HP before it is restored.
 *
 * GDD §4.10 persists HP between encounters, but §11 only makes that survivable
 * because a Depth offers a Sanctum to heal at. M0 has no map, so the set is cut
 * into chains of this length with a full restore between them — the smallest
 * stand-in for the Sanctum that keeps §4.10's attrition real. Without it the
 * arithmetic collapses: six fights on 70 HP with no heal forces every fight to
 * cost under 12 HP, which is another way of saying no fight may matter.
 *
 * **Two, not three, and measured.** At three, the first chain's fights cost
 * about 23, 25 and 27 HP played competently — 75 against a pool of 70 — so the
 * third fight was lost on arrival however well it was played. It is won 100% of
 * the time by every policy including `leftmost` when entered at full HP: it was
 * never a hard encounter, only a third one. At two, every policy clears fights
 * 1–3 and skill starts separating at fight 4 (`leftmost` 18%, `focus` 100%),
 * which is where a *feel* test wants the difficulty to bite — the M0 gate
 * cannot judge six encounters the player never reaches (docs/M0_GATE.md §4).
 *
 * [M0 STAND-IN] Delete this when the map lands and Sanctums are real nodes.
 */
export const CHAIN_SIZE = 2;

/** True when this encounter opens a chain, and so is entered at full HP. */
export function startsChain(index: number): boolean {
  return index % CHAIN_SIZE === 0;
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
    actors: [PLAYER_SEED, rat(PAIR_LEVEL), rat(PAIR_LEVEL, 'rat_b')],
  },
  {
    name: 'The Long Wind',
    teaches: 'Read eight slots ahead: the swing is visible before it lands.',
    actors: [PLAYER_SEED, warden(SOLO_LEVEL)],
  },
  {
    name: 'Discord',
    teaches: 'Slow taxes every card, Heavy ones hardest — watch the cost, not the Weight.',
    actors: [PLAYER_SEED, adept(SOLO_LEVEL)],
  },
  {
    name: 'Guarded Approach',
    teaches: 'Stagger the swing, or hold Guard for it.',
    actors: [PLAYER_SEED, warden(CROWD_LEVEL), rat(CROWD_LEVEL)],
  },
  {
    name: 'The Toll',
    teaches: 'Two clocks at once: chip damage and a wind-up.',
    actors: [PLAYER_SEED, adept(CROWD_LEVEL), rat(CROWD_LEVEL)],
  },
  {
    name: 'Full Consort',
    teaches: 'Everything together, and not enough turns for all of it.',
    actors: [PLAYER_SEED, warden(CROWD_LEVEL), adept(CROWD_LEVEL), rat(CROWD_LEVEL)],
  },
];

/** The fixed regression scenario: one player, one fast enemy (GDD §4.1). */
export function soloRat(): readonly ActorSeed[] {
  return [PLAYER_SEED, rat(PAIR_LEVEL)];
}

export function ratAndWarden(): readonly ActorSeed[] {
  return [PLAYER_SEED, rat(PAIR_LEVEL), warden(PAIR_LEVEL)];
}
