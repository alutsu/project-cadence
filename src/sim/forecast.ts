import type { Action } from './actions.ts';
import type { Actor } from './actor.ts';
import { reduce } from './combat.ts';
import type { ActorId } from './ids.ts';
import { actionDelay } from './speed.ts';
import { findActor, type CombatState } from './state.ts';
import { nextToAct } from './timeline.ts';
import { addTicks, type Tick } from './tick.ts';
import { actorSpeed, isAlive } from './actor.ts';

/** GDD §4.2: the next eight turn slots render as a strip at the top of combat. */
export const QUEUE_SLOTS = 8;

export interface QueueSlot {
  readonly actor: ActorId;
  readonly at: Tick;
}

/**
 * The honest forecast (GDD §4.2). Enemy intents are telegraphed, so their next
 * Weight is known and their future slots are real.
 *
 * The player appears exactly once — at the turn they are already scheduled for.
 * Their turn after that depends on which card they choose, and the strip must
 * not invent a Weight on their behalf. Filling that gap is precisely what the
 * ghost preview does (S3): hovering a card is how the player learns where the
 * choice puts them.
 */
export function forecastQueue(
  state: CombatState,
  slots: number = QUEUE_SLOTS,
): readonly QueueSlot[] {
  const forecast: QueueSlot[] = [];
  let pool = state.actors.filter(isAlive);

  while (forecast.length < slots) {
    const acting = nextToAct(pool);
    if (acting === null) break;

    forecast.push({ actor: acting.id, at: acting.nextActTick });
    pool = pool.filter((actor) => actor.id !== acting.id);

    const projected = projectNextTurn(acting);
    if (projected !== null) pool = [...pool, projected];
  }

  return forecast;
}

/** An actor's next scheduled turn, or null when it cannot honestly be known. */
function projectNextTurn(actor: Actor): Actor | null {
  if (actor.side === 'player' || actor.intent === null) return null;

  return {
    ...actor,
    nextActTick: addTicks(actor.nextActTick, actionDelay(actor.intent.weight, actorSpeed(actor))),
  };
}

export interface PreviewHit {
  readonly target: ActorId;
  readonly amount: number;
}

/**
 * What an action would do, if taken now. Everything the hover state needs, and
 * nothing the UI has to work out for itself (GDD §15: the player should never do
 * multiplication in their head).
 */
export interface ActionPreview {
  /** The queue as it would then unfold. */
  readonly queue: readonly QueueSlot[];
  /** Damage the action would deal, by target. */
  readonly hits: readonly PreviewHit[];
  /** When the player would next act. */
  readonly playerNextTick: Tick | null;
  /** How many enemy turns land before that. */
  readonly enemyTurnsBeforePlayer: number;
  /** What those turns would cost, at their telegraphed damage. */
  readonly incomingDamage: number;
}

/**
 * The ghost preview (GDD §4.2) — the core UX of the entire game.
 *
 * It runs the **real reducer** on a copy and reads the result. There is
 * deliberately no estimator here: a preview that could disagree with the commit
 * would destroy the one promise the queue makes. Returns null for an action the
 * reducer would refuse, since there is nothing honest to show.
 */
export function previewAction(state: CombatState, action: Action): ActionPreview | null {
  const result = reduce(state, action);
  if (!result.ok) return null;

  const projected = result.step.state;
  const queue = forecastQueue(projected);

  // "Before the player" is a question about queue *order*, not about tick
  // numbers: an actor sharing the player's tick still acts first if it wins the
  // Speed tie-break (GDD §4.1). Counting by tick silently under-reported that.
  const playerIndex = queue.findIndex((slot) => isPlayerSlot(projected, slot));
  const playerNextTick = playerIndex === -1 ? null : (queue[playerIndex]?.at ?? null);
  const before = playerIndex === -1 ? queue : queue.slice(0, playerIndex);

  return {
    queue,
    hits: result.step.events
      .filter((event) => event.kind === 'damage_dealt')
      .map((event) => ({ target: event.target, amount: event.amount })),
    playerNextTick,
    enemyTurnsBeforePlayer: before.length,
    incomingDamage: before.reduce((total, slot) => total + intentDamage(projected, slot), 0),
  };
}

function isPlayerSlot(state: CombatState, slot: QueueSlot): boolean {
  return findActor(state, slot.actor)?.side === 'player';
}

function intentDamage(state: CombatState, slot: QueueSlot): number {
  return findActor(state, slot.actor)?.intent?.damage ?? 0;
}
