import { m0Catalogue } from '../data/cards.ts';
import { soloRat } from '../data/encounters.ts';
import type { CombatSetup } from '../sim/combat.ts';
import { cardId } from '../sim/ids.ts';
import { createRng, type Rng } from '../sim/rng.ts';

export { PLAYER, RAT, WARDEN } from '../data/encounters.ts';

export const LIGHT = cardId('lunge');
export const STANDARD = cardId('cleave');
export const HEAVY = cardId('crush');

/**
 * The scripted S1 scenario, now built from the authored deck rather than an
 * inline copy of it — one card source, so the harness and the game agree.
 */
/** The seed the scripted scenario runs on, so its log is reproducible. */
export const SCENARIO_SEED = 20260829;

export function scenario(rng: Rng = createRng(SCENARIO_SEED, 'combat')): CombatSetup {
  return {
    actors: soloRat(),
    catalogue: m0Catalogue(),
    deck: [LIGHT, STANDARD, HEAVY],
    rng,
  };
}
