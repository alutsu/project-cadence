import type { Actor } from './actor.ts';
import { DEFAULT_RULES } from './rules.ts';
import { addTicks, tick, type Tick } from './tick.ts';

/**
 * Guard (GDD §4.4) — the game's only mitigation, and deliberately time-shaped.
 * N Guard is N damage absorbed *or* N ticks of protection, whichever runs out
 * first. Because it decays in the same unit the queue uses, the player can read
 * the strip and see whether it survives to the enemy's next action.
 */
export const GUARD_CAP = DEFAULT_RULES.guardCap;

export function gainGuard(actor: Actor, amount: number, cap = GUARD_CAP): Actor {
  return { ...actor, guard: Math.min(cap, actor.guard + amount) };
}

/**
 * The tick Guard reaches zero on, if nothing hits it first (GDD §4.4), or null
 * when it never does — the M0 tuning console can set decay to 0.
 *
 * Lives here rather than in the HUD that prints it: the decay rate is a rule,
 * and a caption that assumed 1/tick would quietly lie the moment the console
 * moved it (CLAUDE.md §2.1 — the UI never computes a game number).
 */
export function guardHoldsUntil(guard: number, now: Tick, perTick: number): Tick | null {
  if (guard <= 0) return now;
  if (perTick <= 0) return null;
  return addTicks(now, tick(Math.ceil(guard / perTick)));
}

/** Guard lost to the passage of time, never below zero. */
export function decayGuard(actor: Actor, elapsed: number, perTick = 1): Actor {
  if (actor.guard === 0 || elapsed <= 0) return actor;
  return { ...actor, guard: Math.max(0, actor.guard - elapsed * perTick) };
}

export interface Absorption {
  readonly actor: Actor;
  readonly absorbed: number;
  readonly toHp: number;
}

/** Guard is checked and consumed before HP on every incoming hit (GDD §4.4). */
export function absorb(actor: Actor, amount: number): Absorption {
  const absorbed = Math.min(actor.guard, amount);
  const toHp = amount - absorbed;
  return {
    actor: { ...actor, guard: actor.guard - absorbed, hp: Math.max(0, actor.hp - toHp) },
    absorbed,
    toHp,
  };
}
