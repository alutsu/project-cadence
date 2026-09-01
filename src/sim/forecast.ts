import type { Action } from './actions.ts';
import type { Actor, Intent } from './actor.ts';
import { advanceToDecision, reduce } from './combat.ts';
import { advanceTime } from './effects.ts';
import { absorb, decayGuard } from './guard.ts';
import type { ActorId } from './ids.ts';
import { actionDelay } from './speed.ts';
import {
  findActor,
  livingEnemies,
  playerActor,
  type CombatOutcome,
  type CombatState,
  type PendingStrike,
} from './state.ts';
import { resolveHit } from './strike.ts';
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

  // A clone walked forward beside the projection, so "will this actor still be
  // standing when its turn comes?" is answered by the real effect resolution
  // rather than by a second copy of the damage-over-time math (CLAUDE.md §2.2).
  //
  // Dormant through M0: only the player was ever afflicted, and their death
  // ends the encounter rather than removing a slot. A card that Burns an enemy
  // makes it load-bearing — a strip that lists a turn the burning thing will
  // not live to take is a strip that lies, and §4.2 is the whole game.
  let settled = state;

  while (forecast.length < slots) {
    const acting = nextToAct(pool);
    if (acting === null) break;

    if (acting.nextActTick > settled.now) {
      settled = advanceTime(settled, acting.nextActTick).state;
    }
    const standing = findActor(settled, acting.id);
    if (standing === undefined || !isAlive(standing)) {
      pool = pool.filter((actor) => actor.id !== acting.id);
      continue;
    }

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
    intent: {
      name: strike.resolved.name,
      weight: tick(0),
      damage: projectedStrikeDamage(state, strike),
      applies: null,
    },
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

/**
 * What a wind-up strike would land for, if it arrived against the board as it
 * stands now (GDD §4.2).
 *
 * A projection rather than a promise: the strike is priced at impact
 * (docs/M1_PLAN.md D27), so an Empower gained in the meantime, or the intended
 * target dying, will move it. That is the same honesty the strip already gives
 * an enemy intent, and it runs through `resolveHit` — the function the landing
 * itself calls — rather than a second arithmetic path (CLAUDE.md §2.2).
 */
function projectedStrikeDamage(state: CombatState, strike: PendingStrike): number {
  const attacker = findActor(state, strike.source);
  const defender =
    strike.resolved.targeting === 'all' ? livingEnemies(state)[0] : findActor(state, strike.target);

  if (attacker === undefined || defender === undefined) return 0;
  return resolveHit({ resolved: strike.resolved, attacker, defender }, state.weave, state.levers)
    .amount;
}

export interface PreviewHit {
  readonly target: ActorId;
  readonly amount: number;
}

/**
 * A blow the player is due to take, already measured against the Guard they
 * will have when it lands (GDD §4.4).
 *
 * §4.4 claims Guard is legible because it decays in the queue's own unit — but
 * only if something on screen does the subtraction, and the UI is not allowed
 * to (CLAUDE.md §2.1). This is that subtraction.
 */
export interface IncomingHit {
  readonly source: ActorId;
  /** The telegraphed intent's name, so the strip can name what is landing. */
  readonly name: string;
  readonly at: Tick;
  readonly damage: number;
  /** The player's Guard at `at`, after decay. */
  readonly guard: number;
  readonly absorbed: number;
  /** What reaches HP. Zero means the Guard holds. */
  readonly toHp: number;
}

/**
 * The next enemy blow in the forecast, resolved against the Guard the player
 * will have by the time it lands.
 *
 * Nothing but the player's own action can *raise* Guard, so this is exact for
 * every action except Wait — and hovering Wait re-runs it on the state Wait
 * would produce (GDD §4.3), which is how the +3 becomes visible as a defence
 * rather than as a number on a button.
 *
 * Only the eight forecast slots are searched: a blow the strip cannot show is
 * one the player cannot read, and there is nowhere to put the answer.
 */
export function nextIncomingHit(state: CombatState): IncomingHit | null {
  const player = playerActor(state);
  if (player === undefined || !isAlive(player)) return null;

  for (const slot of forecastQueue(state)) {
    const intent = slot.intent;
    // A pending strike is the player's own Ultimate arriving (GDD §22 Q1).
    if (slot.kind !== 'turn' || intent === null || intent.damage <= 0) continue;
    if (findActor(state, slot.actor)?.side !== 'enemy') continue;

    const guarded = decayGuard(player, {
      from: state.now,
      to: slot.at,
      every: state.rules.guardDecayEvery,
    });
    const { absorbed, toHp } = absorb(guarded, intent.damage);
    return {
      source: slot.actor,
      name: intent.name,
      at: slot.at,
      damage: intent.damage,
      guard: guarded.guard,
      absorbed,
      toHp,
    };
  }

  return null;
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
  /**
   * The next of those blows, measured against the Guard it would meet. The one
   * number that answers "does my Guard survive this?" (GDD §4.4).
   */
  readonly nextHit: IncomingHit | null;
  /**
   * The HP the player would next act on, after Guard, every telegraphed hit and
   * every status that resolves on the way (GDD §4.5). Zero means the window
   * kills them — which is the thing the choice is actually about.
   */
  readonly hpWhenPlayerActs: number;
  /** Enemies this action would stagger, and by how much (GDD §4.6). */
  readonly staggers: readonly StaggerPreview[];
  /**
   * What the action would leave the encounter as. A lethal card ends the fight
   * on the player's own turn, so `playerNextTick` names a tick that will never
   * arrive — the UI needs this to say so rather than reading the tick out loud.
   */
  readonly outcome: CombatOutcome;
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

  // Time resolving is not a second estimate of it: this runs the same
  // `advanceToDecision` the commit will run, on a copy, and reads the player
  // off the end (CLAUDE.md §2.2 — the preview has no path of its own).
  const settled = advanceToDecision(projected).state;

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
    nextHit: nextIncomingHit(projected),
    hpWhenPlayerActs: playerActor(settled)?.hp ?? 0,
    staggers: result.step.events
      .filter((event) => event.kind === 'staggered')
      .map((event) => ({ actor: event.actor, delay: event.delay })),
    outcome: projected.outcome,
  };
}

function isPlayerSlot(state: CombatState, slot: QueueSlot): boolean {
  return findActor(state, slot.actor)?.side === 'player';
}

function intentDamage(slot: QueueSlot): number {
  return slot.intent?.damage ?? 0;
}
