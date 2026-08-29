import type { ActorSeed } from '../sim/combat.ts';
import { actorId } from '../sim/ids.ts';
import { tick } from '../sim/tick.ts';

/**
 * M0 encounters, authored by hand. Enemy generation (GDD §12.1) and real intent
 * selection (§12.2) arrive in S7; these carry a single fixed intent so the queue
 * has something honest to forecast.
 */
export const PLAYER = actorId('player');
export const RAT = actorId('rat');
export const WARDEN = actorId('warden');

const PLAYER_SEED: ActorSeed = {
  id: PLAYER,
  name: 'Adventurer',
  side: 'player',
  baseSpeed: 100,
  maxHp: 70,
  intent: null,
};

const RAT_SEED: ActorSeed = {
  id: RAT,
  name: 'Poison Rat',
  side: 'enemy',
  baseSpeed: 130,
  maxHp: 30,
  intent: { name: 'Gnaw', weight: tick(4), damage: 3 },
};

/** GDD §12.2: huge Poise, telegraphs a Weight-16 hit. Poise itself lands in S6. */
const WARDEN_SEED: ActorSeed = {
  id: WARDEN,
  name: 'Warden',
  side: 'enemy',
  baseSpeed: 70,
  maxHp: 60,
  intent: { name: 'Ruinous Swing', weight: tick(16), damage: 18 },
};

/** The fixed regression scenario: one player, one fast enemy (GDD §4.1). */
export function soloRat(): readonly ActorSeed[] {
  return [PLAYER_SEED, RAT_SEED];
}

/** The playable S2 encounter: a fast chipper and a slow hammer, so the queue
 * interleaves and targeting has a choice to make. */
export function ratAndWarden(): readonly ActorSeed[] {
  return [PLAYER_SEED, RAT_SEED, WARDEN_SEED];
}
