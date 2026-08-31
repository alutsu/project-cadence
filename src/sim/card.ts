import type { CardId } from './ids.ts';
import type { Tag } from './tag.ts';
import type { Tick } from './tick.ts';
import type { WeightClass } from './weightClass.ts';

/**
 * Who a card strikes (GDD §4.8). `all` hits every living enemy for a reduced
 * figure; there is no positioning and no lane, so there is nothing between the
 * two to model.
 */
export type CardTargeting = 'single' | 'all';

/**
 * A skill card. Weight and Recovery are ticks (GDD §2 P6, §4.1); the tag is
 * what the Weave multiplies (GDD §7).
 */
export interface CardDefinition {
  readonly id: CardId;
  readonly name: string;
  readonly weightClass: WeightClass;
  readonly weight: Tick;
  readonly recovery: Tick;
  readonly damage: number;
  readonly targeting: CardTargeting;
  /**
   * Exactly one tag per card (docs/M1_PLAN.md D15). One, not a list: the Weave
   * asks what a blow *is*, and a card that were two things at once would have
   * two multipliers and no answer to give the player before they commit (P3).
   */
  readonly tag: Tag;
}

/** Cards addressed by id. A plain record, so CombatState stays serializable. */
export type CardCatalogue = Readonly<Record<string, CardDefinition>>;

export function findCard(catalogue: CardCatalogue, id: CardId): CardDefinition | undefined {
  return catalogue[id];
}
