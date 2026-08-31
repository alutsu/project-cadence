import type { CardDefinition, CardTargeting } from './card.ts';
import type { CardId } from './ids.ts';
import type { Tag } from './tag.ts';
import { damagePerTarget } from './targeting.ts';
import { tick, type Tick } from './tick.ts';
import { ATTUNEMENT_TABLE, type WeaveSnapshot } from './weave.ts';

/**
 * What a card actually does, before anyone has been picked to receive it.
 *
 * The split between this and `strike.ts` is forced by the Weave: a card's
 * damage depends on which enemy it lands on (§7.2 resistance is per-actor), but
 * its Weight, Recovery and reach do not. Everything that can be known without a
 * defender is known here, once per play.
 *
 * This is the only place a card's printed numbers are turned into the numbers
 * the game runs on. `WEIGHT_CLASSES` is never rewritten (GDD §4.1) — riders sit
 * on top of it and are resolved fresh every time.
 */
export interface ResolvedCard {
  readonly card: CardId;
  readonly name: string;
  readonly tag: Tag;
  readonly targeting: CardTargeting;
  /** What one enemy takes before the Weave and before Empower or Weaken. */
  readonly basePerTarget: number;
  readonly weight: Tick;
  readonly recovery: Tick;
}

/**
 * GDD §4.1's delay is `ceil(weight × 100 / speed)`, so a Weight of 0 is a delay
 * of 0 — an actor that acts again on the tick it just acted, forever. Ascendant
 * alone reaches 3 on a Light card; Ascendant plus a HASTE gem reaches 0
 * (docs/M1_PLAN.md D17). The floor is what keeps the scheduler total.
 */
export const MIN_WEIGHT = 1;
const MIN_RECOVERY = 0;

/**
 * GDD §7.1: an Ascendant tag is −1 Weight and a Suppressed one is +1.
 *
 * Signed arithmetic all the way, branded exactly once at the end — `tick()`
 * rejects a negative, so summing riders as `Tick` would throw halfway through a
 * sum that ends up positive (docs/M1_PLAN.md D17).
 */
function riddenWeight(base: Tick, weave: WeaveSnapshot, tag: Tag): Tick {
  const rider = ATTUNEMENT_TABLE[weave.attunement[tag]].weightDelta;
  return tick(Math.max(MIN_WEIGHT, base + rider));
}

/** Everything about a play that does not depend on who receives it. */
export function resolveCard(weave: WeaveSnapshot, card: CardDefinition): ResolvedCard {
  return {
    card: card.id,
    name: card.name,
    tag: card.tag,
    targeting: card.targeting,
    basePerTarget: damagePerTarget(card),
    weight: riddenWeight(card.weight, weave, card.tag),
    recovery: tick(Math.max(MIN_RECOVERY, card.recovery)),
  };
}

/**
 * What this card costs in Weight right now, riders included.
 *
 * The hand and the queue strip need it, and neither is allowed to add the ±1
 * itself (CLAUDE.md §2.1) — a card that says W4 while the queue moves by 3 is
 * the exact failure GDD §15 calls out.
 */
export function resolvedWeight(weave: WeaveSnapshot, card: CardDefinition): Tick {
  return riddenWeight(card.weight, weave, card.tag);
}
