import type { Action } from '../sim/actions.ts';
import { isAlive } from '../sim/actor.ts';
import { findCard } from '../sim/card.ts';
import type { CombatState } from '../sim/state.ts';

/**
 * The greedy-damage policy agent (GDD §19). It plays the hardest-hitting card in
 * hand at the first living enemy and Waits when it cannot. Deliberately stupid:
 * a scripted agent exists to exercise the sim, not to play well.
 */
export function greedyDamage(state: CombatState): Action {
  const target = state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor));
  if (target === undefined) return { kind: 'wait' };

  const best = state.hand
    .map((id) => findCard(state.catalogue, id))
    .filter((card) => card !== undefined)
    .reduce<{ id: (typeof state.hand)[number]; damage: number } | null>((chosen, card) => {
      if (chosen !== null && card.damage <= chosen.damage) return chosen;
      return { id: card.id, damage: card.damage };
    }, null);

  return best === null ? { kind: 'wait' } : { kind: 'play', card: best.id, target: target.id };
}
