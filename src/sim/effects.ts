import { isAlive, settleDeath, type Actor } from './actor.ts';
import type { CombatEvent } from './events.ts';
import { decayGuard } from './guard.ts';
import { applyDamage, resolveHit } from './strike.ts';
import { returnDueCards } from './piles.ts';
import type { CombatState, CombatStep, PendingStrike } from './state.ts';
import { withActor } from './state.ts';
import { strikeTargets } from './targeting.ts';
import {
  BURN_INTERVAL,
  POISON_INTERVAL,
  isPeriodic,
  type Status,
  type StatusKind,
} from './status.ts';
import { addTicks, tick, type Tick } from './tick.ts';

/**
 * Tick-scheduled resolution (GDD §4.5). Damage over time, expiries and Cooldown
 * returns resolve on the timeline, not inside an actor's turn — so a slow actor
 * is never punished twice by the same Poison.
 */
export function advanceTime(state: CombatState, to: Tick): CombatStep {
  const events: CombatEvent[] = [];
  let current = state;

  for (;;) {
    const next = nextEffectTick(current, to);
    if (next === null) break;

    const stepped = resolveAt(carryTo(current, next), next);
    current = stepped.state;
    events.push(...stepped.events);
  }

  return { state: carryTo(current, to), events };
}

/** Moves the clock forward, decaying Guard by one per tick on the way. */
function carryTo(state: CombatState, to: Tick): CombatState {
  const elapsed = to - state.now;
  if (elapsed <= 0) return { ...state, now: to };

  return {
    ...state,
    now: to,
    actors: state.actors.map((actor) =>
      decayGuard(actor, { from: state.now, to, every: state.rules.guardDecayEvery }),
    ),
  };
}

/** The earliest scheduled effect at or before `limit`, if any. */
function nextEffectTick(state: CombatState, limit: Tick): Tick | null {
  const pending = [
    ...state.cooldown.map((entry) => entry.returnTick),
    ...state.pending.map((strike) => strike.landsAt),
    ...state.actors.flatMap((actor) => actor.statuses.flatMap(statusTicks)),
  ].filter((at) => at > state.now && at <= limit);

  return pending.length === 0 ? null : tick(Math.min(...pending));
}

function statusTicks(status: Status): Tick[] {
  const ticks: Tick[] = [];
  if (status.nextProcAt !== null) ticks.push(status.nextProcAt);
  if (status.expiresAt !== null) ticks.push(status.expiresAt);
  return ticks;
}

/**
 * Everything due at one tick, in a fixed order: cards come back first, then
 * damage over time, then expiries. The order is arbitrary but it must be
 * *stable*, or two identical states could diverge.
 */
function resolveAt(state: CombatState, at: Tick): CombatStep {
  const returned = returnDueCards(state, at);
  const landed = landPendingStrikes(returned.state, at);
  const procs = resolveProcs(landed.state, at);
  const expiries = resolveExpiries(procs.state, at);

  return {
    state: expiries.state,
    events: [...returned.events, ...landed.events, ...procs.events, ...expiries.events],
  };
}

/** Ultimates in flight under the wind-up rule (GDD §22 Q1) arriving. */
function landPendingStrikes(state: CombatState, at: Tick): CombatStep {
  const due = state.pending.filter((strike) => strike.landsAt <= at);
  if (due.length === 0) return { state, events: [] };

  const events: CombatEvent[] = [];
  let current: CombatState = { ...state, pending: state.pending.filter((s) => s.landsAt > at) };

  for (const strike of due) {
    const struck = landStrike(current, strike);
    current = struck.state;
    events.push({ kind: 'strike_landed', at, card: strike.resolved.card }, ...struck.events);
  }

  return { state: current, events };
}

/**
 * A strike that has waited out its wind-up lands on whoever is standing now —
 * for an AoE, that is the line as it is at impact, not as it was when the card
 * was committed (GDD §4.8, §22 Q1).
 */
function landStrike(state: CombatState, strike: PendingStrike): CombatStep {
  const events: CombatEvent[] = [];
  let current = state;
  const attacker = current.actors.find((actor) => actor.id === strike.source);

  for (const target of strikeTargets(state, strike.resolved.targeting, strike.target)) {
    const defender = current.actors.find((actor) => actor.id === target);
    if (attacker === undefined || defender === undefined) continue;

    // Priced here, at impact, not at commit. The line this expands over is
    // already the one standing now rather than the one that was there when the
    // card was played, and a damage figure frozen against a different board
    // than the targets it lands on was never a real snapshot — so both follow
    // the same clock (docs/M1_PLAN.md D27).
    const hit = resolveHit({ resolved: strike.resolved, attacker, defender }, current.weave);
    const struck = applyDamage(current, { source: strike.source, target, hit });
    current = struck.state;
    events.push(...struck.events);
  }

  return { state: current, events };
}

function resolveProcs(state: CombatState, at: Tick): CombatStep {
  const events: CombatEvent[] = [];
  let current = state;

  for (const actor of state.actors) {
    const stepped = procActor(current, actor.id, at);
    current = stepped.state;
    events.push(...stepped.events);
  }

  return { state: current, events };
}

function procActor(state: CombatState, id: Actor['id'], at: Tick): CombatStep {
  const actor = state.actors.find((candidate) => candidate.id === id);
  if (actor === undefined || !isAlive(actor)) return { state, events: [] };

  const due = actor.statuses.filter((status) => status.nextProcAt === at);
  if (due.length === 0) return { state, events: [] };

  const events: CombatEvent[] = [];
  let hp = actor.hp;

  for (const status of due) {
    // Poison ignores Guard (GDD §4.5); so does Burn, since both are already
    // resolving outside the hit pipeline that Guard sits in front of.
    hp = Math.max(0, hp - status.magnitude);
    events.push({
      kind: 'status_proc',
      at,
      actor: id,
      status: status.kind,
      amount: status.magnitude,
    });
  }

  const statuses = actor.statuses.map((status) =>
    due.includes(status) ? advanceProc(status, at) : status,
  );
  const stepped: Actor = { ...actor, hp, statuses: statuses.filter(isLive) };
  if (hp === 0) events.push({ kind: 'actor_died', at, actor: id });

  return { state: withActor(state, settleDeath(stepped)), events };
}

/** Poison loses one magnitude per proc; Burn does not (GDD §4.5). */
function advanceProc(status: Status, at: Tick): Status {
  const magnitude = status.kind === 'poison' ? status.magnitude - 1 : status.magnitude;
  return {
    ...status,
    magnitude,
    nextProcAt: addTicks(at, tick(intervalFor(status.kind))),
  };
}

function intervalFor(kind: StatusKind): number {
  return kind === 'burn' ? BURN_INTERVAL : POISON_INTERVAL;
}

function isLive(status: Status): boolean {
  return !isPeriodic(status.kind) || status.magnitude > 0;
}

function resolveExpiries(state: CombatState, at: Tick): CombatStep {
  const events: CombatEvent[] = [];

  const actors = state.actors.map((actor) => {
    const expired = actor.statuses.filter(
      (status) => status.expiresAt !== null && status.expiresAt <= at,
    );
    if (expired.length === 0) return actor;

    for (const status of expired)
      events.push({ kind: 'status_expired', at, actor: actor.id, status: status.kind });
    return { ...actor, statuses: actor.statuses.filter((status) => !expired.includes(status)) };
  });

  return { state: { ...state, actors }, events };
}
