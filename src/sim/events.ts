import type { ActorId, CardId } from './ids.ts';
import type { Tick } from './tick.ts';

/**
 * The combat event log (GDD §20.3). Append-only and typed as a discriminated
 * union: riddles, telemetry, replays and the ghost preview all read this rather
 * than reaching into state. Adding a kind is additive — consumers ignore what
 * they do not recognise.
 */
export type CombatEvent =
  | { readonly kind: 'combat_started'; readonly at: Tick }
  | {
      readonly kind: 'actor_scheduled';
      readonly at: Tick;
      readonly actor: ActorId;
      readonly nextActTick: Tick;
    }
  | { readonly kind: 'turn_started'; readonly at: Tick; readonly actor: ActorId }
  | {
      readonly kind: 'card_played';
      readonly at: Tick;
      readonly actor: ActorId;
      readonly card: CardId;
      readonly weight: Tick;
    }
  | { readonly kind: 'waited'; readonly at: Tick; readonly actor: ActorId }
  | { readonly kind: 'card_drawn'; readonly at: Tick; readonly card: CardId }
  | {
      readonly kind: 'draw_skipped';
      readonly at: Tick;
      readonly reason: 'hand_full' | 'draw_pile_empty';
    }
  | {
      readonly kind: 'card_cooled';
      readonly at: Tick;
      readonly card: CardId;
      readonly returnTick: Tick;
    }
  | { readonly kind: 'card_returned'; readonly at: Tick; readonly card: CardId }
  | {
      readonly kind: 'intent_executed';
      readonly at: Tick;
      readonly actor: ActorId;
      readonly intent: string;
    }
  | {
      readonly kind: 'damage_dealt';
      readonly at: Tick;
      readonly source: ActorId;
      readonly target: ActorId;
      readonly amount: number;
    }
  | { readonly kind: 'actor_died'; readonly at: Tick; readonly actor: ActorId }
  | { readonly kind: 'combat_ended'; readonly at: Tick; readonly outcome: 'won' | 'lost' };
