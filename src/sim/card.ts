import type { CardId } from './ids.ts';
import type { Tick } from './tick.ts';
import type { WeightClass } from './weightClass.ts';

/**
 * A skill card. Weight and Recovery are ticks (GDD §2 P6, §4.1); damage is flat
 * in M0 — tags exist as labels and multiply nothing until the Weave lands in M1
 * (docs/M0_PLAN.md §2, D9).
 */
export interface CardDefinition {
  readonly id: CardId;
  readonly name: string;
  readonly weightClass: WeightClass;
  readonly weight: Tick;
  readonly recovery: Tick;
  readonly damage: number;
  /**
   * Inert in M0: tags are labels that multiply nothing until the Weave arrives
   * in M1 (docs/M0_PLAN.md D9). The taxonomy is authored with it, not before.
   */
  readonly tags: readonly string[];
}

/** Cards addressed by id. A plain record, so CombatState stays serializable. */
export type CardCatalogue = Readonly<Record<string, CardDefinition>>;

export function findCard(catalogue: CardCatalogue, id: CardId): CardDefinition | undefined {
  return catalogue[id];
}
