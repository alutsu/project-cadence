import type { Actor } from './actor.ts';
import { magnitudeOf } from './status.ts';
import { addTicks, tick, type Tick } from './tick.ts';

/**
 * Poise and Stagger (GDD §4.6).
 *
 * [AMD] Poise is a **threshold**, not a pool: a single hit at or above it
 * staggers, and chip damage never does. The player's question is one comparison
 * — "can this card break it?" — which is what keeps Stagger a planned act.
 */
export const FIRST_STAGGER = 3;
export const MIN_STAGGER = 1;
/** Poise cannot be driven below this by Brittle. */
export const MIN_POISE = 1;

/**
 * [FIX] Each Stagger on the same enemy is worth half the last: 3, 2, 1, 1, 1…
 * Without it a Break build denies a slow boss every turn and the encounter
 * stops being a game.
 */
export function staggerDelay(alreadyApplied: number, first = FIRST_STAGGER): Tick {
  return tick(Math.max(MIN_STAGGER, first - alreadyApplied));
}

/** Poise after Brittle (GDD §4.5), never below one. */
export function effectivePoise(actor: Actor): number {
  return Math.max(MIN_POISE, actor.poise - magnitudeOf(actor.statuses, 'brittle'));
}

/** Whether one hit of `amount` breaks this actor's Poise. */
export function breaksPoise(actor: Actor, amount: number): boolean {
  return actor.poise > 0 && amount >= effectivePoise(actor);
}

export interface StaggerResult {
  readonly actor: Actor;
  readonly delay: Tick;
}

/** Pushes the actor's next turn back, and remembers that it happened. */
export function stagger(actor: Actor, first = FIRST_STAGGER): StaggerResult {
  const delay = staggerDelay(actor.staggersTaken, first);
  return {
    actor: {
      ...actor,
      nextActTick: addTicks(actor.nextActTick, delay),
      staggersTaken: actor.staggersTaken + 1,
    },
    delay,
  };
}
