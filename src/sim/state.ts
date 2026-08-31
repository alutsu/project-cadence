import { isAlive, type Actor } from './actor.ts';
import type { CardCatalogue, CardTargeting } from './card.ts';
import type { CombatRules } from './rules.ts';
import type { ActorId, CardId } from './ids.ts';
import type { Tick } from './tick.ts';

export type CombatOutcome = 'ongoing' | 'won' | 'lost';

/** A played card, waiting out its Recovery (GDD §4.9). */
export interface CooldownEntry {
  readonly card: CardId;
  readonly returnTick: Tick;
}

/**
 * A plain, serializable value (CLAUDE.md §2.2): no class instances, no
 * functions, no Map or Set. The reducer returns new states; nothing mutates one.
 */
/** An Ultimate in flight under the wind-up rule (GDD §22 Q1). */
export interface PendingStrike {
  readonly card: CardId;
  readonly name: string;
  readonly source: ActorId;
  readonly target: ActorId;
  /**
   * Expanded when the strike lands, never when it is committed: an AoE hits the
   * enemies that are alive at the moment of impact (GDD §4.8), and a wind-up is
   * long enough for that to be a different set.
   */
  readonly targeting: CardTargeting;
  /** What one enemy takes, already reduced if this strike hits all of them. */
  readonly amount: number;
  readonly landsAt: Tick;
}

export interface CombatState {
  readonly now: Tick;
  readonly rules: CombatRules;
  /** Strikes that have been committed but have not landed yet. */
  readonly pending: readonly PendingStrike[];
  readonly actors: readonly Actor[];
  readonly catalogue: CardCatalogue;
  /** The draw pile, top first. Never reshuffled mid-encounter (GDD §4.9). */
  readonly draw: readonly CardId[];
  readonly hand: readonly CardId[];
  /** Played cards, each due back at its own tick (GDD §4.9). */
  readonly cooldown: readonly CooldownEntry[];
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

/**
 * Every enemy still standing, in seat order. The order is the actor order, so
 * an AoE resolves left to right and the event log reads the way the line looks.
 */
export function livingEnemies(state: CombatState): readonly Actor[] {
  return state.actors.filter((actor) => actor.side === 'enemy' && isAlive(actor));
}

/** Replaces one actor, leaving every other reference in the state untouched. */
export function withActor(state: CombatState, updated: Actor): CombatState {
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.id === updated.id ? updated : actor)),
  };
}
