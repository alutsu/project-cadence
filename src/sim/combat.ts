import type { Action, IllegalAction } from './actions.ts';
import {
  actorSpeed,
  currentIntent,
  isAlive,
  nextIntentIndex,
  type Actor,
  type Intent,
  type StatusApplication,
} from './actor.ts';
import { findCard, type CardCatalogue, type CardDefinition } from './card.ts';
import { advanceTime } from './effects.ts';
import { absorb, gainGuard } from './guard.ts';
import { OPENING_HAND, drawOne, sendToCooldown, shuffle } from './piles.ts';
import { breaksPoise, stagger } from './poise.ts';
import type { Rng } from './rng.ts';
import { DEFAULT_RULES, WINDUP_COMMIT_WEIGHT, type CombatRules } from './rules.ts';
import type { CombatEvent } from './events.ts';
import type { ActorId, CardId } from './ids.ts';
import { BASE_SPEED, actionDelay, combatSeedTick, drawsOnAction, effectiveSpeed } from './speed.ts';
import { damagePerTarget, strikeTargets } from './targeting.ts';
import { nextToAct } from './timeline.ts';
import {
  findActor,
  playerActor,
  withActor,
  type CombatOutcome,
  type CombatState,
  type PendingStrike,
} from './state.ts';
import { POISON_INTERVAL, damageScale, isPeriodic, magnitudeOf, type Status } from './status.ts';
import { addTicks, TICK_ZERO, tick, type Tick } from './tick.ts';
import { NEUTRAL_WEAVE, NO_RESISTANCE, type ResistanceTable, type WeaveSnapshot } from './weave.ts';

/**
 * Combat is a reducer: `(State, Action) => State`, immutable, emitting an event
 * log (GDD §20.3, CLAUDE.md §2.2). Time advances separately from actions —
 * `reduce` commits what an actor chose, `advanceToDecision` resolves the ticks
 * between one player decision and the next.
 */
export interface CombatStep {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

export type ReduceResult =
  | { readonly ok: true; readonly step: CombatStep }
  | { readonly ok: false; readonly error: IllegalAction };

export interface ActorSeed {
  readonly id: ActorId;
  readonly name: string;
  readonly side: Actor['side'];
  readonly baseSpeed: number;
  readonly maxHp: number;
  /**
   * Health on entering the encounter. Absent means full, which is every enemy
   * and the first fight of a set; the player carries a wound forward between
   * encounters instead (GDD §4.10).
   */
  readonly hp?: number;
  /** GDD §4.6. Zero means nothing staggers this actor — the player's case. */
  readonly poise: number;
  /** GDD §7.2. Absent means the actor shrugs off nothing. */
  readonly resistances?: ResistanceTable;
  readonly intents: readonly Intent[];
}

export interface CombatSetup {
  readonly actors: readonly ActorSeed[];
  readonly catalogue: CardCatalogue;
  /** The player's deck. Shuffled at combat start from the injected stream. */
  readonly deck: readonly CardId[];
  readonly rng: Rng;
  /** Tuning knobs for the M0 feel pass; defaults when omitted. */
  readonly rules?: CombatRules;
  /**
   * Where the tags stand (GDD §7). Omitted means neutral — which is what every
   * M0 test and the balance harness want, and is why the M0 golden log is
   * unchanged by the Weave arriving.
   */
  readonly weave?: WeaveSnapshot;
}

interface DamageOrder {
  readonly source: ActorId;
  readonly target: ActorId;
  readonly amount: number;
}

/** GDD §4.1: seed every actor at `ceil(600 / speed)`; faster actors act first. */
export function startCombat(setup: CombatSetup): CombatStep {
  const actors = withDistinctNames(setup.actors).map((seed, index) => seedActor(seed, index));
  const state: CombatState = {
    now: TICK_ZERO,
    rules: setup.rules ?? DEFAULT_RULES,
    weave: setup.weave ?? NEUTRAL_WEAVE,
    pending: [],
    actors,
    catalogue: setup.catalogue,
    draw: shuffle(setup.deck, setup.rng),
    hand: [],
    cooldown: [],
    activeActorId: null,
    outcome: 'ongoing',
  };

  const events: CombatEvent[] = [
    { kind: 'combat_started', at: TICK_ZERO },
    ...actors.map((actor): CombatEvent => ({
      kind: 'actor_scheduled',
      at: TICK_ZERO,
      actor: actor.id,
      nextActTick: actor.nextActTick,
    })),
  ];

  return dealOpeningHand({ state, events });
}

function dealOpeningHand(start: CombatStep): CombatStep {
  let step = start;
  for (let dealt = 0; dealt < OPENING_HAND; dealt += 1) {
    const drawn = drawOne(step.state);
    step = { state: drawn.state, events: [...step.events, ...drawn.events] };
  }
  return step;
}

const NO_SPEED_GAIN = 0;

/** A seed that enters wounded must still be alive and within its pool. */
function startingHp(seed: ActorSeed): number {
  if (seed.hp === undefined) return seed.maxHp;
  if (!Number.isInteger(seed.hp) || seed.hp <= 0 || seed.hp > seed.maxHp) {
    throw new RangeError(
      `actor "${seed.id}" entered with ${String(seed.hp)} HP, outside 1..${String(seed.maxHp)}`,
    );
  }
  return seed.hp;
}

/**
 * Two Poison Rats are two different problems — one may be staggered, poisoned or
 * nearly dead while the other is not — but the queue strip names an actor, and a
 * name that appears twice points at no silhouette in particular. Duplicated
 * names get a running number in seat order, so a slot can be matched to a lane
 * by eye (GDD §15, P5).
 *
 * An unduplicated name is left alone: a "Warden 1" standing on its own is a
 * number that answers nothing. The ordinal is fixed at the start of the
 * encounter and never renumbered, so Rat 2 stays Rat 2 after Rat 1 dies —
 * position is what shifts, identity is not.
 */
export function withDistinctNames(seeds: readonly ActorSeed[]): readonly ActorSeed[] {
  const totals = new Map<string, number>();
  for (const seed of seeds) totals.set(seed.name, (totals.get(seed.name) ?? 0) + 1);

  const numbered = new Map<string, number>();
  return seeds.map((seed) => {
    if ((totals.get(seed.name) ?? 0) < 2) return seed;
    const ordinal = (numbered.get(seed.name) ?? 0) + 1;
    numbered.set(seed.name, ordinal);
    return { ...seed, name: `${seed.name} ${String(ordinal)}` };
  });
}

function seedActor(seed: ActorSeed, index: number): Actor {
  const hp = startingHp(seed);
  return {
    id: seed.id,
    name: seed.name,
    side: seed.side,
    index,
    baseSpeed: seed.baseSpeed,
    speedGain: NO_SPEED_GAIN,
    hp,
    maxHp: seed.maxHp,
    guard: 0,
    poise: seed.poise,
    resistances: seed.resistances ?? NO_RESISTANCE,
    staggersTaken: 0,
    statuses: [],
    nextActTick: combatSeedTick(effectiveSpeed(seed.baseSpeed, NO_SPEED_GAIN)),
    actionsCommitted: 0,
    intents: seed.intents,
    intentIndex: 0,
  };
}

/** Reschedules an actor by an action's Weight (GDD §4.1). */
function reschedule(actor: Actor, from: Tick, cost: ActionCost): Actor {
  const delay = actionDelay(cost.weight, actorSpeed(actor));
  return {
    ...actor,
    nextActTick: addTicks(from, tick(Math.max(1, delay - (cost.refund ?? 0)))),
    actionsCommitted: actor.actionsCommitted + 1,
  };
}

interface ActionCost {
  readonly weight: Tick;
  /** Ticks handed back, for the Ultimate refund rule (GDD §22 Q1). */
  readonly refund?: number;
}

function usesWindup(state: CombatState, card: CardDefinition): boolean {
  return state.rules.ultimate === 'windup' && card.weightClass === 'ultimate';
}

/**
 * GDD §22 Q1, candidate (c): half the Weight comes back if the Ultimate kills.
 * A finisher rather than an opener.
 */
function refundOnKill(
  state: CombatState,
  card: CardDefinition,
  events: readonly CombatEvent[],
): number {
  if (state.rules.ultimate !== 'refund' || card.weightClass !== 'ultimate') return 0;
  if (!events.some((event) => event.kind === 'actor_died')) return 0;
  return Math.floor(actionDelay(card.weight, BASE_SPEED) / 2);
}

interface PendingOrder {
  readonly actor: Actor;
  readonly card: CardDefinition;
  readonly target: Actor;
}

/**
 * GDD §22 Q1, candidate (a): the blow is committed now and lands at now +
 * Weight. The player keeps acting while it is in flight, and the queue shows it
 * coming — so the cost is commitment and exposure rather than four lost turns.
 */
function commitPending(state: CombatState, order: PendingOrder): CombatStep {
  const landsAt = addTicks(state.now, order.card.weight);
  const pending: PendingStrike = {
    card: order.card.id,
    name: order.card.name,
    source: order.actor.id,
    target: order.target.id,
    targeting: order.card.targeting,
    amount: damagePerTarget(order.card),
    landsAt,
  };

  return {
    state: { ...state, pending: [...state.pending, pending] },
    events: [
      {
        kind: 'strike_committed',
        at: state.now,
        actor: order.actor.id,
        card: order.card.id,
        landsAt,
      },
    ],
  };
}

interface StrikeOrder {
  readonly source: ActorId;
  readonly card: CardDefinition;
  readonly chosen: ActorId;
}

/**
 * A card's damage, dealt to everything it reaches (GDD §4.8).
 *
 * Blows land one at a time rather than as a batch: each one can kill, and each
 * one's Poise is checked against the figure *that* enemy took, which is what
 * makes an AoE stagger a rat and leave a Warden standing ([AMD] §4.8). The log
 * therefore reads in the order the line was struck, left to right.
 */
function strikeAll(state: CombatState, order: StrikeOrder): CombatStep {
  const amount = damagePerTarget(order.card);
  const events: CombatEvent[] = [];
  let current = state;

  for (const target of strikeTargets(state, order.card.targeting, order.chosen)) {
    const struck = applyDamage(current, { source: order.source, target, amount });
    current = struck.state;
    events.push(...struck.events);
  }

  return { state: current, events };
}

/**
 * Guard is checked before HP from S5 (GDD §4.4); in S1 damage lands straight on
 * HP so the scheduler can be tested on its own.
 *
 * Deliberately does not settle the encounter's outcome: the actor that struck
 * still has to be rescheduled, and the log must read in causal order.
 */
function applyDamage(state: CombatState, order: DamageOrder): CombatStep {
  const target = findActor(state, order.target);
  if (target === undefined || !isAlive(target)) return { state, events: [] };

  const source = findActor(state, order.source);
  const amount = Math.round(order.amount * damageScale(source?.statuses ?? []));
  const { actor: wounded, absorbed } = absorb(target, amount);

  const events: CombatEvent[] = [
    { kind: 'damage_dealt', at: state.now, source: order.source, target: order.target, amount },
  ];
  if (absorbed > 0) {
    events.push({ kind: 'guard_absorbed', at: state.now, actor: order.target, amount: absorbed });
  }

  // GDD §4.6: a single hit at or above the Poise threshold staggers. The check
  // uses the damage the attack carried, before Guard soaked any of it.
  const shaken =
    isAlive(wounded) && breaksPoise(wounded, amount)
      ? stagger(wounded, state.rules.firstStagger)
      : null;
  if (shaken !== null) {
    events.push({ kind: 'staggered', at: state.now, actor: order.target, delay: shaken.delay });
  }
  if (!isAlive(wounded)) events.push({ kind: 'actor_died', at: state.now, actor: order.target });

  return { state: withActor(state, shaken?.actor ?? wounded), events };
}

/** Applies an intent's status to the player, if it carries one (GDD §4.5). */
function inflictIntent(state: CombatState, application: StatusApplication | null): CombatStep {
  const player = playerActor(state);
  if (application === null || player === undefined || !isAlive(player)) {
    return { state, events: [] };
  }

  return applyStatus(state, player.id, {
    kind: application.kind,
    magnitude: application.magnitude,
    expiresAt: application.duration === null ? null : addTicks(state.now, application.duration),
    nextProcAt: isPeriodic(application.kind) ? addTicks(state.now, tick(POISON_INTERVAL)) : null,
  });
}

/** GDD §4.5: Bleed deals its damage whenever the afflicted actor acts. */
function sufferBleed(state: CombatState, actor: Actor): CombatStep {
  const bleed = magnitudeOf(actor.statuses, 'bleed');
  if (bleed === 0) return { state, events: [] };

  const { actor: bled } = absorb(actor, bleed);
  return {
    state: withActor(state, bled),
    events: [
      { kind: 'status_proc', at: state.now, actor: actor.id, status: 'bleed', amount: bleed },
    ],
  };
}

/** Applies a status, replacing any existing one of the same kind. */
export function applyStatus(state: CombatState, target: ActorId, status: Status): CombatStep {
  const actor = findActor(state, target);
  if (actor === undefined || !isAlive(actor)) return { state, events: [] };

  const statuses = [...actor.statuses.filter((held) => held.kind !== status.kind), status];
  return {
    state: withActor(state, { ...actor, statuses }),
    events: [
      {
        kind: 'status_applied',
        at: state.now,
        actor: target,
        status: status.kind,
        magnitude: status.magnitude,
      },
    ],
  };
}

function currentOutcome(state: CombatState): CombatOutcome {
  const player = playerActor(state);
  if (player === undefined || !isAlive(player)) return 'lost';
  const enemies = state.actors.filter((actor) => actor.side === 'enemy');
  return enemies.some(isAlive) ? 'ongoing' : 'won';
}

/** Closes the encounter once, after the turn that ended it has fully resolved. */
function settleOutcome(state: CombatState, events: readonly CombatEvent[]): CombatStep {
  const outcome = currentOutcome(state);
  if (outcome === 'ongoing' || state.outcome !== 'ongoing') return { state, events };

  return {
    state: { ...state, outcome, activeActorId: null },
    events: [...events, { kind: 'combat_ended', at: state.now, outcome }],
  };
}

function resolveEnemyTurn(state: CombatState, enemy: Actor): CombatStep {
  const at = enemy.nextActTick;
  const started: CombatState = { ...state, now: at, activeActorId: enemy.id };
  const intent = currentIntent(enemy);
  if (intent === null) {
    return { state: started, events: [{ kind: 'turn_started', at, actor: enemy.id }] };
  }

  const bled = sufferBleed(started, enemy);
  const player = playerActor(bled.state);
  const events: CombatEvent[] = [
    { kind: 'turn_started', at, actor: enemy.id },
    { kind: 'intent_executed', at, actor: enemy.id, intent: intent.name },
    ...bled.events,
  ];

  const struck =
    player === undefined
      ? { state: bled.state, events: [] }
      : applyDamage(bled.state, { source: enemy.id, target: player.id, amount: intent.damage });

  // The intent lands, then the rotation advances — so what the strip showed is
  // what happened, and what it shows next is what comes next (GDD §4.2).
  const inflicted = inflictIntent(struck.state, intent.applies);
  const rotated = { ...currentActor(inflicted.state, enemy), intentIndex: nextIntentIndex(enemy) };
  const acted = withActor(inflicted.state, reschedule(rotated, at, { weight: intent.weight }));

  return settleOutcome({ ...acted, activeActorId: null }, [
    ...events,
    ...struck.events,
    ...inflicted.events,
    scheduledEvent(acted, enemy.id, at),
  ]);
}

/**
 * One turn's worth of time. `turn` means an enemy acted and time can advance
 * again; `settled` means it has stopped — the player is due, or the encounter
 * is over.
 *
 * Exists so a caller can watch the queue drain one slot at a time instead of
 * only seeing where it landed. The UI plays each step as a beat (GDD §15).
 */
export type Advance =
  | { readonly kind: 'turn'; readonly actor: ActorId; readonly step: CombatStep }
  | { readonly kind: 'settled'; readonly step: CombatStep };

/**
 * Advances time up to and including the next enemy turn, or up to the point
 * where time stops. Enemy turns are time resolving, not actions — only the
 * player's choices go through `reduce`.
 */
export function advanceOneTurn(state: CombatState): Advance {
  const events: CombatEvent[] = [];
  let current = state;

  for (;;) {
    if (current.outcome !== 'ongoing') return settled(current, events);

    const next = nextToAct(current.actors);
    if (next === null) return settled(current, events);

    // Tick-scheduled effects resolve between turns (GDD §3): Cooldown returns,
    // damage over time, expiries, and Guard decaying one per tick along the way.
    const elapsed = advanceTime(current, next.nextActTick);
    current = elapsed.state;
    events.push(...elapsed.events);

    // Damage over time can settle the encounter before anyone acts again.
    const closed = settleOutcome(current, []);
    current = closed.state;
    events.push(...closed.events);
    if (current.outcome !== 'ongoing') return settled(current, events);

    // A corpse still holds a slot until time reaches it; nothing to show for it.
    if (!isAlive(next)) continue;

    if (next.side === 'player') {
      const opened = openPlayerTurn(current, next);
      return settled(opened.state, [...events, ...opened.events]);
    }

    const step = resolveEnemyTurn(current, next);
    return {
      kind: 'turn',
      actor: next.id,
      step: { state: step.state, events: [...events, ...step.events] },
    };
  }
}

function settled(state: CombatState, events: readonly CombatEvent[]): Advance {
  return { kind: 'settled', step: { state, events } };
}

/**
 * Advances time, resolving enemy turns, until the player is due to act or the
 * encounter is over.
 */
export function advanceToDecision(state: CombatState): CombatStep {
  const events: CombatEvent[] = [];
  let current = state;

  for (;;) {
    const advance = advanceOneTurn(current);
    current = advance.step.state;
    events.push(...advance.step.events);
    if (advance.kind === 'settled') return { state: current, events };
  }
}

/**
 * The scheduling event for an actor that has just been rescheduled. Reads the
 * tick back off the new state rather than recomputing it, so the log can never
 * disagree with the queue.
 */
function scheduledEvent(state: CombatState, actor: ActorId, at: Tick): CombatEvent {
  const rescheduled = findActor(state, actor);
  if (rescheduled === undefined)
    throw new Error(`rescheduled actor is missing from state: ${actor}`);
  return { kind: 'actor_scheduled', at, actor, nextActTick: rescheduled.nextActTick };
}

/**
 * The player's turn opens with a draw (GDD §3). Above the Speed soft cap that
 * draw comes every other action instead — extra actions accrue, extra cards do
 * not (GDD §4.7).
 */
function openPlayerTurn(state: CombatState, player: Actor): CombatStep {
  const at = player.nextActTick;
  const opened: CombatState = { ...state, now: at, activeActorId: player.id };
  const events: CombatEvent[] = [{ kind: 'turn_started', at, actor: player.id }];

  if (!drawsOnAction(actorSpeed(player), player.actionsCommitted)) {
    return { state: opened, events };
  }

  const drawn = drawOne(opened);
  return { state: drawn.state, events: [...events, ...drawn.events] };
}

/** Commits the acting player's choice. Illegal actions are refused here. */
export function reduce(state: CombatState, action: Action): ReduceResult {
  if (state.outcome !== 'ongoing') return { ok: false, error: { reason: 'combat_over' } };

  const actor = activePlayer(state);
  if (actor === null) {
    return { ok: false, error: { reason: 'not_your_turn', activeActor: state.activeActorId } };
  }

  return action.kind === 'wait'
    ? { ok: true, step: commitWait(state, actor) }
    : commitPlay(state, actor, action);
}

function activePlayer(state: CombatState): Actor | null {
  const active = state.activeActorId;
  if (active === null) return null;
  const actor = findActor(state, active);
  return actor?.side === 'player' ? actor : null;
}

/**
 * GDD §4.3 [AMD]: Wait is an action, not a card — it enters no Cooldown pile and
 * has no anti-spam rule. Its draw and its 3 Guard arrive with the piles (S4) and
 * Guard (S5).
 */
function commitWait(state: CombatState, actor: Actor): CombatStep {
  const at = state.now;
  const bled = sufferBleed(state, actor);
  const drawn = drawOne(bled.state);

  // GDD §4.3: Weight 3, draw 1, gain 3 Guard.
  const guarded = withActor(
    drawn.state,
    gainGuard(currentActor(drawn.state, actor), state.rules.waitGuard, state.rules.guardCap),
  );
  const acted = withActor(
    guarded,
    reschedule(currentActor(guarded, actor), at, { weight: state.rules.waitWeight }),
  );

  return settleOutcome({ ...acted, activeActorId: null }, [
    { kind: 'waited', at, actor: actor.id },
    ...bled.events,
    ...drawn.events,
    { kind: 'guard_gained', at, actor: actor.id, amount: state.rules.waitGuard },
    scheduledEvent(acted, actor.id, at),
  ]);
}

/** The freshest copy of an actor, after earlier steps have rewritten state. */
function currentActor(state: CombatState, actor: Actor): Actor {
  return findActor(state, actor.id) ?? actor;
}

function commitPlay(
  state: CombatState,
  actor: Actor,
  action: { readonly card: CardId; readonly target: ActorId },
): ReduceResult {
  const card = findCard(state.catalogue, action.card);
  if (card === undefined)
    return { ok: false, error: { reason: 'unknown_card', card: action.card } };
  if (!state.hand.includes(action.card)) {
    return { ok: false, error: { reason: 'card_not_in_hand', card: action.card } };
  }

  const target = findActor(state, action.target);
  if (target === undefined)
    return { ok: false, error: { reason: 'unknown_target', target: action.target } };
  if (!isAlive(target))
    return { ok: false, error: { reason: 'target_is_dead', target: action.target } };

  const at = state.now;
  const bled = sufferBleed(state, actor);
  const windup = usesWindup(state, card);

  const struck = windup
    ? commitPending(bled.state, { actor, card, target })
    : strikeAll(bled.state, { source: actor.id, card, chosen: target.id });

  const cooled = sendToCooldown(struck.state, card.id);
  const committed = windup ? WINDUP_COMMIT_WEIGHT : card.weight;
  const acted = withActor(
    cooled.state,
    reschedule(currentActor(cooled.state, actor), at, {
      weight: committed,
      refund: refundOnKill(state, card, struck.events),
    }),
  );

  return {
    ok: true,
    step: settleOutcome({ ...acted, activeActorId: null }, [
      { kind: 'card_played', at, actor: actor.id, card: card.id, weight: card.weight },
      ...bled.events,
      ...struck.events,
      ...cooled.events,
      scheduledEvent(acted, actor.id, at),
    ]),
  };
}
