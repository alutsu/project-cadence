import type { Actor } from './actor.ts';
import type { CardCatalogue } from './card.ts';
import type { ActorId, CardId } from './ids.ts';
import type { Tick } from './tick.ts';

export type CombatOutcome = 'ongoing' | 'won' | 'lost';

/**
 * A plain, serializable value (CLAUDE.md §2.2): no class instances, no
 * functions, no Map or Set. The reducer returns new states; nothing mutates one.
 */
export interface CombatState {
  readonly now: Tick;
  readonly actors: readonly Actor[];
  readonly catalogue: CardCatalogue;
  /** S4 replaces this with the full draw / hand / Cooldown piles (GDD §4.9). */
  readonly hand: readonly CardId[];
  /** Whose turn it is, or null while time is still advancing. */
  readonly activeActorId: ActorId | null;
  readonly outcome: CombatOutcome;
}

export function findActor(state: CombatState, id: ActorId): Actor | undefined {
  return state.actors.find((actor) => actor.id === id);
}

export function playerActor(state: CombatState): Actor | undefined {
  return state.actors.find((actor) => actor.side === 'player');
}

/** Replaces one actor, leaving every other reference in the state untouched. */
export function withActor(state: CombatState, updated: Actor): CombatState {
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.id === updated.id ? updated : actor)),
  };
}
