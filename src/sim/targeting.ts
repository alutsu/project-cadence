import type { Actor } from './actor.ts';
import type { CardDefinition, CardTargeting } from './card.ts';
import type { ActorId } from './ids.ts';
import { livingEnemies, type CombatState } from './state.ts';

/**
 * GDD §4.8: an AoE card hits every enemy for a reduced share of its damage —
 * "typically 60%". The number is the design's, not this module's; it lives here
 * as a named constant so it can be tuned in one place rather than found inside
 * a reducer.
 */
export const AOE_DAMAGE_SHARE = 0.6;

/**
 * What one enemy takes from this card.
 *
 * The printed damage is what a single-target card deals and what an AoE card
 * would deal if it hit one thing — never what an AoE actually lands. The hand
 * has to show the reduced figure rather than the printed one (P3), and the sim
 * has to be the place that works it out (CLAUDE.md §2.1), so both read it here.
 */
export function damagePerTarget(card: CardDefinition): number {
  return card.targeting === 'all' ? Math.round(card.damage * AOE_DAMAGE_SHARE) : card.damage;
}

/**
 * Who a strike lands on, resolved against the line as it stands *now*.
 *
 * An AoE ignores the chosen target: §4.8 has no positioning, so there is
 * nothing for the click to mean beyond keeping the sticky target it already
 * set. It still matters for the next card.
 */
export function strikeTargets(
  state: CombatState,
  targeting: CardTargeting,
  chosen: ActorId,
): readonly ActorId[] {
  if (targeting === 'single') return [chosen];
  return livingEnemies(state).map((enemy: Actor) => enemy.id);
}
