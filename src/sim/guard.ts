import type { Actor } from './actor.ts';
import { DEFAULT_RULES } from './rules.ts';
import { tick, type Tick } from './tick.ts';

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
export function guardHoldsUntil(guard: number, now: Tick, every: number): Tick | null {
  if (guard <= 0) return now;
  if (every <= 0) return null;

  // The tick the last point falls off, on the same grid `decayGuard` uses —
  // so the queue strip's "guard holds until" is the tick it actually holds to,
  // not an estimate that drifts from it by up to `every - 1`.
  return tick((Math.floor(now / every) + guard) * every);
}

/** Guard lost to the passage of time, never below zero. */
/**
 * Guard falls off on a fixed clock (GDD §4.4 [AMD]).
 *
 * Computed from **absolute** ticks rather than an elapsed count, and that is
 * the whole trick: `floor(to / every) - floor(from / every)` sums correctly
 * however finely time is advanced. A per-call `floor(elapsed / every)` would
 * round three separate one-tick advances down to nothing each time and Guard
 * would never decay at all — which is exactly the bug a fractional
 * `perTick` invites.
 */
export interface DecayWindow {
  readonly from: Tick;
  readonly to: Tick;
  /** Ticks per point lost. Larger is slower, and a longer window. */
  readonly every: number;
}

export function decayGuard(actor: Actor, window: DecayWindow): Actor {
  if (actor.guard === 0 || window.to <= window.from) return actor;

  const lost = pointsLost(window.from, window.to, window.every);
  return lost === 0 ? actor : { ...actor, guard: Math.max(0, actor.guard - lost) };
}

export function pointsLost(from: Tick, to: Tick, every: number): number {
  if (every <= 0) return 0;
  return Math.floor(to / every) - Math.floor(from / every);
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
