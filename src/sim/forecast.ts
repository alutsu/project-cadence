import type { Action } from './actions.ts';
import type { Actor, Intent } from './actor.ts';
import { reduce } from './combat.ts';
import type { ActorId } from './ids.ts';
import { actionDelay } from './speed.ts';
import { findActor, type CombatState } from './state.ts';
import { nextToAct } from './timeline.ts';
import { addTicks, tick, type Tick } from './tick.ts';
import { actorSpeed, currentIntent, isAlive, nextIntentIndex } from './actor.ts';

/** GDD §4.2: the next eight turn slots render as a strip at the top of combat. */
export const QUEUE_SLOTS = 8;

export interface QueueSlot {
  readonly actor: ActorId;
  readonly at: Tick;
  /** A scheduled turn, or an Ultimate in flight arriving (GDD §22 Q1). */
  readonly kind: 'turn' | 'strike';
  /**
   * What the actor will do in *this* slot. Carried on the slot rather than read
   * off the actor, because a rotation means slot six is not slot one's intent.
   */
  readonly intent: Intent | null;
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

    forecast.push({
      actor: acting.id,
      at: acting.nextActTick,
      kind: 'turn',
      intent: currentIntent(acting),
    });
    pool = pool.filter((actor) => actor.id !== acting.id);

    const projected = projectNextTurn(acting);
    if (projected !== null) pool = [...pool, projected];
  }

  return mergePending(forecast, state, slots);
}

/**
 * A committed Ultimate takes a slot of its own, because the whole point of the
 * wind-up rule is that the queue shows it coming (GDD §22 Q1).
 */
function mergePending(
  turns: readonly QueueSlot[],
  state: CombatState,
  slots: number,
): readonly QueueSlot[] {
  if (state.pending.length === 0) return turns;

  const strikes: QueueSlot[] = state.pending.map((strike) => ({
    actor: strike.source,
    at: strike.landsAt,
    kind: 'strike',
    intent: { name: strike.name, weight: tick(0), damage: strike.amount, applies: null },
  }));

  // Effects resolve before turns at the same tick, so a strike sorts first.
  return [...turns, ...strikes]
    .sort((left, right) => left.at - right.at || rank(left) - rank(right))
    .slice(0, slots);
}

function rank(slot: QueueSlot): number {
  return slot.kind === 'strike' ? 0 : 1;
}

/** An actor's next scheduled turn, or null when it cannot honestly be known. */
function projectNextTurn(actor: Actor): Actor | null {
  const intent = currentIntent(actor);
  if (actor.side === 'player' || intent === null) return null;

  // The rotation is deterministic, so the projection advances it too: slot six
  // shows the intent that will actually be telegraphed there (GDD §4.2).
  return {
    ...actor,
    nextActTick: addTicks(actor.nextActTick, actionDelay(intent.weight, actorSpeed(actor))),
    intentIndex: nextIntentIndex(actor),
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
  /** Enemies this action would stagger, and by how much (GDD §4.6). */
  readonly staggers: readonly StaggerPreview[];
}

export interface StaggerPreview {
  readonly actor: ActorId;
  readonly delay: Tick;
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
    incomingDamage: before.reduce((total, slot) => total + intentDamage(slot), 0),
    staggers: result.step.events
      .filter((event) => event.kind === 'staggered')
      .map((event) => ({ actor: event.actor, delay: event.delay })),
  };
}

function isPlayerSlot(state: CombatState, slot: QueueSlot): boolean {
  return findActor(state, slot.actor)?.side === 'player';
}

function intentDamage(slot: QueueSlot): number {
  return slot.intent?.damage ?? 0;
}
