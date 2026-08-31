import { isAlive, type Actor } from './actor.ts';
import type { CardCatalogue } from './card.ts';
import type { CombatEvent } from './events.ts';
import type { ResolvedCard } from './resolve.ts';
import type { CombatRules } from './rules.ts';
import type { ActorId, CardId } from './ids.ts';
import type { Tick } from './tick.ts';
import type { WeaveSnapshot } from './weave.ts';

export type CombatOutcome = 'ongoing' | 'won' | 'lost';

/**
 * A state and the log of how it got there — what every step of the sim returns.
 *
 * The reducer, the tick-scheduled effects and the pile transitions all produce
 * exactly this, and used to each declare their own name for it. Three identical
 * shapes is where CLAUDE.md §5.5 says the abstraction has been earned.
 */
export interface CombatStep {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

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
  readonly source: ActorId;
  readonly target: ActorId;
  /**
   * The card as it was resolved at commit — but *priced* only at impact.
   *
   * M0 stored a bare number here, which was never a real snapshot: `landStrike`
   * already expands an AoE against the line that is standing when it arrives
   * (GDD §4.8), not the one that was there when the card was played. Carrying
   * the resolved card instead of a figure makes the rest agree with that, and
   * is what lets both damage paths share one resolver (docs/M1_PLAN.md D27).
   */
  readonly resolved: ResolvedCard;
  readonly landsAt: Tick;
}

export interface CombatState {
  readonly now: Tick;
  readonly rules: CombatRules;
  /**
   * Where every tag stands this encounter (GDD §7), assembled by the run layer
   * and carried *in* the state for the reason `rules` gives above: a value the
   * reducer reads from outside could make two otherwise-identical states behave
   * differently, and the ghost preview clones the state, not the module.
   */
  readonly weave: WeaveSnapshot;
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
