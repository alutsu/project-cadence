import type { Actor } from './actor.ts';

/**
 * Guard (GDD §4.4) — the game's only mitigation, and deliberately time-shaped.
 * N Guard is N damage absorbed *or* N ticks of protection, whichever runs out
 * first. Because it decays in the same unit the queue uses, the player can read
 * the strip and see whether it survives to the enemy's next action.
 */
export const GUARD_CAP = 40;
export const GUARD_DECAY_PER_TICK = 1;

export function gainGuard(actor: Actor, amount: number): Actor {
  return { ...actor, guard: Math.min(GUARD_CAP, actor.guard + amount) };
}

/** Guard lost to the passage of time, never below zero. */
export function decayGuard(actor: Actor, elapsed: number): Actor {
  if (actor.guard === 0 || elapsed <= 0) return actor;
  return { ...actor, guard: Math.max(0, actor.guard - elapsed * GUARD_DECAY_PER_TICK) };
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
