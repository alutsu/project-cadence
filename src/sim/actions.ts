import type { ActorId, CardId } from './ids.ts';
import { tick, type Tick } from './tick.ts';

/**
 * Everything the player may do on their turn. A discriminated union, never a
 * flag plus optional fields (CLAUDE.md §3.2).
 */
export type Action =
  | { readonly kind: 'play'; readonly card: CardId; readonly target: ActorId }
  | { readonly kind: 'wait' };

/** GDD §4.3: Wait is Weight 3, draw 1, gain 3 Guard. */
export const WAIT_WEIGHT: Tick = tick(3);

/**
 * Why an action was refused. Illegal actions are rejected by the reducer, not
 * merely prevented by the UI (CLAUDE.md §5.4).
 */
export type IllegalAction =
  | { readonly reason: 'not_your_turn'; readonly activeActor: ActorId | null }
  | { readonly reason: 'combat_over' }
  | { readonly reason: 'unknown_card'; readonly card: CardId }
  | { readonly reason: 'card_not_in_hand'; readonly card: CardId }
  | { readonly reason: 'unknown_target'; readonly target: ActorId }
  | { readonly reason: 'target_is_dead'; readonly target: ActorId };
